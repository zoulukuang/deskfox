// FORK-ONLY: llm-stream-idle-timeout 单测 [feat: llm-stream-idle-timeout] 2026-06-11
// R8 用例清单见 docs/features/llm-stream-idle-timeout/1-spec.md
import { describe, expect, test } from "bun:test"
import { DEFAULT_CHUNK_TIMEOUT_MS, effectiveChunkTimeout } from "../../src/provider/stream-timeout"
import { wrapSSE } from "../../src/provider/provider"

describe("effectiveChunkTimeout", () => {
  // 用例 1:未配置 → 默认 120s(本修复核心)
  test("undefined returns default 120s", () => {
    expect(effectiveChunkTimeout(undefined)).toBe(DEFAULT_CHUNK_TIMEOUT_MS)
    expect(effectiveChunkTimeout(null)).toBe(DEFAULT_CHUNK_TIMEOUT_MS)
  })

  // 用例 2:显式 false → 关闭
  test("false disables", () => {
    expect(effectiveChunkTimeout(false)).toBeUndefined()
  })

  // 用例 3:用户值优先
  test("positive number wins over default", () => {
    expect(effectiveChunkTimeout(45_000)).toBe(45_000)
  })

  // 用例 4:0/负数/非法类型 → undefined(沿用上游 >0 才生效语义,不静默回退默认)
  test("zero, negative and invalid values disable", () => {
    expect(effectiveChunkTimeout(0)).toBeUndefined()
    expect(effectiveChunkTimeout(-1)).toBeUndefined()
    expect(effectiveChunkTimeout(Number.NaN)).toBeUndefined()
    expect(effectiveChunkTimeout(Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(effectiveChunkTimeout("120000")).toBeUndefined()
    expect(effectiveChunkTimeout(true)).toBeUndefined()
  })
})

function sseResponse(body: ReadableStream<Uint8Array> | null, contentType = "text/event-stream") {
  return new Response(body, { headers: { "content-type": contentType } })
}

describe("wrapSSE", () => {
  // 用例 5(bug-repro):流发 1 个 chunk 后永久停滞 = 2026-06-11 现网死连接场景
  // (sidecar 吊死 ESTABLISHED 连接,对端不再发数据也不关流,请求永久悬挂)
  test("[bug-repro] stalled SSE stream aborts within chunk timeout instead of hanging forever", async () => {
    const ctl = new AbortController()
    const stalled = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode("data: first\n\n"))
        // 之后永不 enqueue、永不 close —— 模拟死连接
      },
    })
    const wrapped = wrapSSE(sseResponse(stalled), 50, ctl)
    const reader = wrapped.body!.getReader()

    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(new TextDecoder().decode(first.value)).toBe("data: first\n\n")

    const begin = Date.now()
    await expect(reader.read()).rejects.toThrow("SSE read timed out")
    expect(Date.now() - begin).toBeLessThan(2_000) // 远小于"永久"
    expect(ctl.signal.aborted).toBe(true)
  })

  // 用例 6:非 SSE 响应原样透传不包裹
  test("non-SSE response passes through untouched", () => {
    const ctl = new AbortController()
    const res = sseResponse(new ReadableStream(), "application/json")
    expect(wrapSSE(res, 50, ctl)).toBe(res)
  })

  // 用例 7:正常流不误杀
  test("healthy stream within timeout is fully readable", async () => {
    const ctl = new AbortController()
    const chunks = ["data: a\n\n", "data: b\n\n", "data: c\n\n"]
    const healthy = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        for (const chunk of chunks) {
          await new Promise((r) => setTimeout(r, 10))
          ctrl.enqueue(new TextEncoder().encode(chunk))
        }
        ctrl.close()
      },
    })
    const wrapped = wrapSSE(sseResponse(healthy), 1_000, ctl)
    const reader = wrapped.body!.getReader()
    const out: string[] = []
    while (true) {
      const part = await reader.read()
      if (part.done) break
      out.push(new TextDecoder().decode(part.value))
    }
    expect(out.join("")).toBe(chunks.join(""))
    expect(ctl.signal.aborted).toBe(false)
  })
})
