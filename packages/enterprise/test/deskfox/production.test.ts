import { expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { env } from "node:process"

// Real built Node server, separate from the existing desktop app and all production storage.
test("production Node artifact serves SSR/assets and revokes the public page and API", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "deskfox-share-production-")))
  const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = listener.port!
  listener.stop(true)
  const process = Bun.spawn(["node", ".output/server/index.mjs"], {
    env: {
      ...env,
      HOST: "127.0.0.1",
      PORT: String(port),
      OPENCODE_STORAGE_ADAPTER: "filesystem",
      DESKFOX_SHARE_DIRECTORY: directory,
      DESKFOX_SHARE_PUBLIC_ORIGIN: "https://deskfox.cn",
      DESKFOX_SHARE_MIN_FREE_BYTES: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const base = `http://127.0.0.1:${port}`
  try {
    const ready = { value: false }
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(`${base}/api/share/health`).catch(() => undefined)
      if (response) {
        expect(response.status).toBe(200)
        ready.value = true
        break
      }
      if (process.exitCode !== null) throw new Error("Share test process exited")
      await Bun.sleep(100)
    }
    expect(ready.value).toBe(true)
    expect((await fetch(`${base}/api/doc`)).status).toBe(200)
    const created = await fetch(`${base}/api/share`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "f".repeat(64) },
      body: JSON.stringify({ sessionID: "ses_runtime" }),
    })
    expect(created.status).toBe(200)
    const share = (await created.json()) as { id: string; secret: string }
    expect((await fetch(`${base}/share/${share.id}`)).status).toBe(404)
    const snapshot = [
      {
        type: "session",
        data: {
          id: "ses_runtime",
          slug: "runtime",
          projectID: "proj_test",
          directory: "/test",
          version: "1",
          title: "SHARE_RUNTIME_TEST",
          time: { created: 1, updated: 1 },
        },
      },
      {
        type: "message",
        data: {
          id: "msg_user",
          sessionID: "ses_runtime",
          role: "user",
          agent: "build",
          model: { providerID: "test", modelID: "test" },
          time: { created: 1 },
        },
      },
      {
        type: "part",
        data: {
          id: "prt_user",
          sessionID: "ses_runtime",
          messageID: "msg_user",
          type: "text",
          text: "SHARE_USER_TEXT",
        },
      },
      {
        type: "message",
        data: {
          id: "msg_assistant",
          sessionID: "ses_runtime",
          role: "assistant",
          parentID: "msg_user",
          modelID: "test",
          providerID: "test",
          mode: "build",
          agent: "build",
          path: { cwd: "/test", root: "/test" },
          cost: 0,
          tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
          finish: "stop",
          time: { created: 2, completed: 3 },
        },
      },
      {
        type: "part",
        data: {
          id: "prt_assistant",
          sessionID: "ses_runtime",
          messageID: "msg_assistant",
          type: "text",
          text: "SHARE_ASSISTANT_TEXT",
        },
      },
    ]
    const synced = await fetch(`${base}/api/share/${share.id}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: share.secret, data: snapshot }),
    })
    expect(synced.status).toBe(200)
    const chunks = await Promise.all((await readdir(".output/server/chunks/_")).filter((name) => name.startsWith("_shareID_") && name.endsWith(".mjs")).map((name) => readFile(path.join(".output/server/chunks/_", name), "utf8")))
    const functionID = chunks.map((text) => text.match(/\}, "([a-f0-9]{64})"\);/)?.[1]).find(Boolean)
    expect(functionID).toBeDefined()
    const rpc = `/_server?id=${functionID}&args=${encodeURIComponent(JSON.stringify([share.id]))}`
    const rpcResponse = await fetch(base + rpc, { headers: { "X-Server-Instance": "share-test" } })
    expect(rpcResponse.status).toBe(200)
    expect(rpcResponse.headers.get("cache-control")).toBe("no-store")
    expect(await rpcResponse.text()).toContain("SHARE_USER_TEXT")
    const page = await fetch(`${base}/share/${share.id}`)
    expect(page.status).toBe(200)
    expect(page.headers.get("cache-control")).toBe("no-store")
    const html = await page.text()
    expect(html).toContain("SHARE_RUNTIME_TEST")
    expect(html).toContain("SHARE_USER_TEXT")
    expect(html).toContain("SHARE_ASSISTANT_TEXT")
    expect(html).not.toContain(share.secret)
    expect(html).not.toContain("social-cards.sst.dev")
    expect(html).not.toContain("Unable to render this share")
    const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_build\/[^"?]+)/g)].map((match) => match[1]))]
    expect(assets.length).toBeGreaterThan(0)
    for (const asset of assets) expect((await fetch(base + asset)).status).toBe(200)
    expect((await fetch(`${base}/share-assets/deskfox.png`)).status).toBe(200)
    expect(
      (
        await fetch(`${base}/api/share/${share.id}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret: share.secret }),
        })
      ).status,
    ).toBe(200)
    for (const route of [`/share/${share.id}`, `/api/share/${share.id}/data`, rpc]) {
      const revoked = await fetch(base + route, { headers: { "X-Server-Instance": "share-test" } })
      expect(revoked.status).toBe(404)
      expect(revoked.headers.get("cache-control")).toBe("no-store")
      const body = await revoked.text()
      expect(body).not.toContain("SHARE_USER_TEXT")
      if (route.startsWith("/api/")) expect(body).toBe(JSON.stringify({ code: "ShareNotFound" }))
    }
  } finally {
    process.kill()
    await process.exited
    const stderr = await new Response(process.stderr).text()
    if (stderr.trim()) console.error(stderr)
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
