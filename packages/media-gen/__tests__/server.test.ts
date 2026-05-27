// [feat: media-creation-mode] 2026-05-26 — /generate 服务路由 smoke(不绑端口,直接调 handler)
import { describe, expect, test } from "bun:test"
import { handler } from "../src/server"

describe("media server handler", () => {
  test("GET /healthz → ok", async () => {
    const r = await handler(new Request("http://127.0.0.1/healthz"))
    expect(r.status).toBe(200)
    expect((await r.json()).ok).toBe(true)
  })

  test("OPTIONS 预检 → 204 + CORS", async () => {
    const r = await handler(new Request("http://127.0.0.1/generate", { method: "OPTIONS" }))
    expect(r.status).toBe(204)
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })

  test("POST /generate 未知模型 → 404", async () => {
    const r = await handler(
      new Request("http://127.0.0.1/generate", {
        method: "POST",
        body: JSON.stringify({ entryId: "nope", input: {} }),
      }),
    )
    expect(r.status).toBe(404)
  })

  test("未知路由 → 404", async () => {
    const r = await handler(new Request("http://127.0.0.1/whatever"))
    expect(r.status).toBe(404)
  })
})
