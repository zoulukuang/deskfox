// [feat: media-gen-minimax] 2026-05-28 — dispatch by-provider 路由单测
// 验证 runEntry 按 entry.providerKey 正确分流到 alibaba vs minimax 引擎(不真打 API)
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runEntry } from "../src/dispatch"
import { findEntry } from "../src/registry"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

// 临时 auth.json:既有 alibaba-cn 又有 minimax-cn
function makeAuthJson(): string {
  const dir = join(tmpdir(), `media-gen-dispatch-test-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, "auth.json")
  writeFileSync(
    p,
    JSON.stringify({
      "alibaba-cn": { type: "api", key: "sk-alibaba-fake" },
      "minimax-cn": { type: "api", key: "sk-minimax-fake" },
    }),
  )
  return p
}

describe("runEntry by-provider 路由", () => {
  test("alibaba entry → 调 dashscope 端点(URL 含 dashscope.aliyuncs.com)", async () => {
    const authPath = makeAuthJson()
    let hitUrl = ""
    const fetchImpl = (async (url: string) => {
      hitUrl = String(url)
      // dashscope image-synthesis 异步任务路径,返回 PENDING → SUCCEEDED
      if (hitUrl.includes("image-synthesis")) {
        return res(200, { output: { task_id: "t1", task_status: "PENDING" } })
      }
      return res(200, { output: { task_status: "SUCCEEDED", results: [{ url: "https://oss/a.png" }] } })
    }) as unknown as typeof fetch

    const entry = findEntry("alibaba-wanx2.1-t2i-turbo", { authPath })
    expect(entry).toBeDefined()
    const out = await runEntry(entry!, { prompt: "p", fetchImpl, pollIntervalMs: 1 }, { authPath })
    expect(hitUrl).toContain("dashscope.aliyuncs.com")
    expect(out.urls).toEqual(["https://oss/a.png"])
    expect(out.provider).toBe("通义万相")
    rmSync(authPath, { force: true })
  })

  test("minimax entry → 调 minimaxi.com 端点 + 不走 dashscope", async () => {
    const authPath = makeAuthJson()
    let hitUrl = ""
    const fetchImpl = (async (url: string) => {
      hitUrl = String(url)
      return res(200, { base_resp: { status_code: 0 }, data: { image_urls: ["https://mx/x.jpg"] } })
    }) as unknown as typeof fetch

    const entry = findEntry("minimax-image-01", { authPath })
    expect(entry).toBeDefined()
    const out = await runEntry(entry!, { prompt: "p", fetchImpl }, { authPath })
    expect(hitUrl).toContain("minimaxi.com")
    expect(hitUrl).not.toContain("dashscope")
    expect(out.urls).toEqual(["https://mx/x.jpg"])
    expect(out.provider).toBe("MiniMax")
    expect(out.model).toBe("image-01")
    rmSync(authPath, { force: true })
  })

  test("minimax tts → 返回 audio kind + file:// URL", async () => {
    const authPath = makeAuthJson()
    const fetchImpl = (async () =>
      res(200, { base_resp: { status_code: 0 }, data: { audio: "deadbeef" } })) as unknown as typeof fetch

    const entry = findEntry("minimax-speech-02-turbo", { authPath })
    const out = await runEntry(entry!, { prompt: "你好", voice: "female-shaonv", fetchImpl }, { authPath })
    expect(out.kind).toBe("audio")
    expect(out.url?.startsWith("file://")).toBe(true)
    expect(out.url).toContain(".mp3")
    rmSync(authPath, { force: true })
  })

  test("没 key → 抛 provider 专属的 no_key 错误", async () => {
    // 空 auth.json(没配任何 provider)
    const dir = join(tmpdir(), `media-gen-dispatch-nokey-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const authPath = join(dir, "auth.json")
    writeFileSync(authPath, JSON.stringify({}))

    // findEntry 返回 undefined(provider 没配 key 时不算可用)→ 测试场景里我们绕过 findEntry 直接构造 entry
    // (registry 已确认 filter 行为,这里测 dispatch 自己也有兜底)
    const entry = { id: "x", capability: "image" as const, provider: "MiniMax", providerKey: "minimax-cn", model: "image-01", displayName: "x" }
    const p = runEntry(entry, { prompt: "p" }, { authPath })
    await expect(p).rejects.toThrow(/未找到.*API Key|no_key/)
    rmSync(authPath, { force: true })
  })
})
