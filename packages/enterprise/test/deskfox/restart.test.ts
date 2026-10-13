import { expect, test } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

test("Node process restarts preserve publication, recovery keys and deletion tombstones", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "deskfox-share-restart-")))
  const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = listener.port!
  listener.stop(true)
  const base = `http://127.0.0.1:${port}`
  const create = () =>
    fetch(`${base}/api/share`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "e".repeat(64) },
      body: JSON.stringify({ sessionID: "ses_restart" }),
    })
  const state = { id: "", secret: "" }
  try {
    for (const generation of [0, 1, 2]) {
      const child = Bun.spawn(["node", ".output/server/index.mjs"], {
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: String(port),
          OPENCODE_STORAGE_ADAPTER: "filesystem",
          DESKFOX_SHARE_DIRECTORY: directory,
          DESKFOX_SHARE_PUBLIC_ORIGIN: "https://deskfox.ai",
          DESKFOX_SHARE_MIN_FREE_BYTES: "1",
        },
        stdout: "ignore",
        stderr: "pipe",
      })
      try {
        await ready(base, child)
        const response = await create()
        if (generation === 2) {
          expect(response.status).toBe(409)
          expect(await response.text()).toBe(JSON.stringify({ code: "ShareConflict" }))
          expect((await fetch(`${base}/api/share/${state.id}/data`)).status).toBe(404)
          expect((await fetch(`${base}/share/${state.id}`)).status).toBe(404)
          continue
        }
        expect(response.status).toBe(200)
        const share = (await response.json()) as { id: string; secret: string; url: string }
        expect(share.url).toBe(`https://deskfox.ai/share/${share.id}`)
        if (generation === 0) {
          Object.assign(state, share)
          const response = await fetch(`${base}/api/share/${share.id}/sync`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              secret: share.secret,
              data: [
                {
                  type: "session",
                  data: {
                    id: "ses_restart",
                    slug: "restart",
                    projectID: "proj_test",
                    directory: "/test",
                    version: "1",
                    title: "RESTART_PERSISTENCE",
                    time: { created: 1, updated: 1 },
                  },
                },
              ],
            }),
          })
          expect(response.status).toBe(200)
          continue
        }
        expect(share.id).toBe(state.id)
        expect(share.secret).toBe(state.secret)
        const data = await fetch(`${base}/api/share/${share.id}/data`)
        expect(data.status).toBe(200)
        expect(await data.text()).toContain("RESTART_PERSISTENCE")
        expect(
          (
            await fetch(`${base}/api/share/${share.id}`, {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ secret: share.secret }),
            })
          ).status,
        ).toBe(200)
      } finally {
        child.kill()
        await child.exited
        const stderr = await new Response(child.stderr).text()
        if (stderr.trim()) console.error(stderr)
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

async function ready(base: string, child: ReturnType<typeof Bun.spawn>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${base}/api/share/health`).catch(() => undefined)
    if (response?.status === 200) return
    if (child.exitCode !== null) throw new Error("Share test process exited")
    await Bun.sleep(100)
  }
  throw new Error("Share server did not become ready")
}
