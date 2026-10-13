import { afterEach, expect, test } from "bun:test"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRepository } from "../../src/deskfox/repository"
import { createShareApi } from "../../src/deskfox/api"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture(origin = "https://deskfox.cn", createsPerMinute = 10) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "deskfox-share-api-")))
  directories.push(directory)
  const repository = await createRepository({ directory, maxBytes: 50_000, minimumFreeBytes: 0 })
  return createShareApi({
    repository,
    origin,
    requestBytes: 20_000,
    requestsPerMinute: 100,
    createsPerMinute,
    concurrency: 4,
  })
}

const session = {
  type: "session",
  data: {
    id: "ses_test",
    slug: "test",
    projectID: "proj_test",
    directory: "/test",
    version: "1",
    title: "Test only",
    time: { created: 1, updated: 1 },
  },
}

test("two independent regions publish and cancel without Host influence or cross-region data", async () => {
  const cn = await fixture()
  const global = await fixture("https://deskfox.ai")
  const response = await cn.request("/api/share", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "e".repeat(64),
      "x-forwarded-host": "evil.example",
      host: "evil.example",
      "x-forwarded-proto": "http",
    },
    body: JSON.stringify({ sessionID: "ses_test" }),
  })
  expect(response.status).toBe(200)
  const share = (await response.json()) as { id: string; secret: string; url: string }
  expect(share.url).toBe(`https://deskfox.cn/share/${share.id}`)
  expect((await cn.request(`/api/share/${share.id}/data`)).status).toBe(404)
  const sync = await cn.request(`/api/share/${share.id}/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: share.secret, data: [session] }),
  })
  expect(sync.status).toBe(200)
  const data = await cn.request(`/api/share/${share.id}/data`)
  expect(data.headers.get("cache-control")).toBe("no-store")
  expect((await data.json()) as (typeof session)[]).toEqual([session])
  expect((await global.request(`/api/share/${share.id}/data`)).status).toBe(404)
  const removed = await cn.request(`/api/share/${share.id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: share.secret }),
  })
  expect(removed.status).toBe(200)
  const missing = await cn.request(`/api/share/${share.id}/data`)
  expect(missing.status).toBe(404)
  expect(await missing.text()).toBe(JSON.stringify({ code: "ShareNotFound" }))
})

test("OpenAPI generation succeeds and local admin route is unavailable", async () => {
  const api = await fixture()
  const doc = await api.request("/api/doc")
  expect(doc.status).toBe(200)
  expect(await doc.text()).toContain('"/api/share/{id}/sync"')
  expect((await api.request("/api/support/actions/remove-share", { method: "DELETE" })).status).toBe(404)
})

test("malformed JSON, payload and oversized streamed bodies fail with safe structured responses", async () => {
  const api = await fixture()
  for (const body of [
    "{",
    JSON.stringify({ sessionID: "../bad" }),
    JSON.stringify({ sessionID: "ses_test", extra: true }),
  ]) {
    const response = await api.request("/api/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toBe(JSON.stringify({ code: "ShareInvalid" }))
  }
  const response = await api.request("/api/share", { method: "POST", body: "x".repeat(20_001) })
  expect(response.status).toBe(413)
  expect(await response.text()).toBe(JSON.stringify({ code: "ShareTooLarge" }))
  expect(response.headers.get("cache-control")).toBe("no-store")
})

test("anonymous create throttling applies before allocating more shares", async () => {
  const api = await fixture("https://deskfox.cn", 1)
  const request = { method: "POST", body: JSON.stringify({ sessionID: "ses_test" }) }
  expect((await api.request("/api/share", request)).status).toBe(200)
  const limited = await api.request("/api/share", request)
  expect(limited.status).toBe(429)
  expect(limited.headers.get("retry-after")).toBe("60")
})

test("malformed renderer fields are rejected without changing the published snapshot", async () => {
  const api = await fixture()
  const created = await api.request("/api/share", { method: "POST", body: JSON.stringify({ sessionID: "ses_test" }) })
  const share = (await created.json()) as { id: string; secret: string }
  const message = {
    type: "message",
    data: {
      id: "msg_test",
      sessionID: "ses_test",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "test", modelID: "test" },
    },
  }
  const sync = (data: unknown[]) =>
    api.request(`/api/share/${share.id}/sync`, {
      method: "POST",
      body: JSON.stringify({ secret: share.secret, data }),
    })
  expect((await sync([session, message])).status).toBe(200)
  for (const fields of [
    { type: "tool", tool: "read", callID: "call_test", state: { status: "completed" } },
    { type: "tool", tool: "read", callID: "call_test", state: { status: "running", input: [], time: { start: 1 } } },
    { type: "file", mime: "image/png", url: "data:image/png;base64,AA==", filename: 42 },
    { type: "patch", hash: "test", files: "bad" },
    { type: "agent", name: [] },
  ]) {
    expect(
      (
        await sync([
          { type: "part", data: { id: "prt_test", sessionID: "ses_test", messageID: "msg_test", ...fields } },
        ])
      ).status,
    ).toBe(400)
    expect(await (await api.request(`/api/share/${share.id}/data`)).json()).toHaveLength(2)
  }
})

test("configured provider IDs survive user, assistant and model sharing", async () => {
  const api = await fixture()
  const created = await api.request("/api/share", {
    method: "POST",
    body: JSON.stringify({ sessionID: "ses_test" }),
    headers: { "content-type": "application/json" },
  })
  const share = (await created.json()) as { id: string; secret: string }
  const providerID = "gateway.example/自定义:1"
  const tokens = { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
  const response = await api.request(`/api/share/${share.id}/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret: share.secret,
      data: [
        session,
        {
          type: "message",
          data: {
            id: "msg_user",
            sessionID: "ses_test",
            role: "user",
            time: { created: 1 },
            agent: "build",
            model: { providerID, modelID: "test" },
          },
        },
        {
          type: "message",
          data: {
            id: "msg_assistant",
            sessionID: "ses_test",
            role: "assistant",
            time: { created: 2 },
            parentID: "msg_user",
            agent: "build",
            mode: "build",
            providerID,
            modelID: "test",
            path: { cwd: "/test", root: "/test" },
            cost: 0,
            tokens,
          },
        },
        {
          type: "model",
          data: [
            {
              id: "test",
              name: "Custom",
              providerID,
              api: { id: "test", url: "https://private.example", npm: "@ai-sdk/openai-compatible" },
              cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
              limit: { context: 1000, output: 100 },
              capabilities: {},
              options: {},
              headers: { Authorization: "private-test-token" },
              status: "active",
              release_date: "2026-10-13",
            },
          ],
        },
      ],
    }),
  })
  expect(response.status).toBe(200)
  const data = await (await api.request(`/api/share/${share.id}/data`)).text()
  expect(data.split(providerID)).toHaveLength(4)
  expect(data).not.toContain("private-test-token")
  expect(data).not.toContain("private.example")
  const invalid = await api.request(`/api/share/${share.id}/sync`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret: share.secret,
      data: [{ ...session, data: { ...session.data, id: "../ses_test" } }],
    }),
  })
  expect(invalid.status).toBe(400)
})
