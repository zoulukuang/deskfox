// [feat: media-gen-alibaba] 2026-05-26 — DashScope 文生图 pipeline 单元测试(mock fetch,不联网不花钱)
import { describe, expect, test } from "bun:test"
import { DashScopeError, generateImage, normalizeSize } from "../src/dashscope-image"

/** 造一个最小 Response 替身,只实现 generateImage 用到的 ok/status/json */
function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe("normalizeSize", () => {
  test("把 x / X / × 统一成星号", () => {
    expect(normalizeSize("1024x1024")).toBe("1024*1024")
    expect(normalizeSize("1280X720")).toBe("1280*720")
    expect(normalizeSize("768×1344")).toBe("768*1344")
    expect(normalizeSize("1024*1024")).toBe("1024*1024")
  })
})

describe("generateImage", () => {
  test("submit → poll(RUNNING) → SUCCEEDED 返回 URL", async () => {
    let pollCount = 0
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("image-synthesis")) {
        return res(200, { output: { task_id: "t1", task_status: "PENDING" } })
      }
      pollCount++
      if (pollCount < 2) return res(200, { output: { task_id: "t1", task_status: "RUNNING" } })
      return res(200, {
        output: { task_id: "t1", task_status: "SUCCEEDED", results: [{ url: "https://oss/x.png" }] },
      })
    }) as unknown as typeof fetch

    const out = await generateImage({ apiKey: "k", prompt: "p", fetchImpl, pollIntervalMs: 1, maxWaitMs: 5000 })
    expect(out.urls).toEqual(["https://oss/x.png"])
    expect(out.taskId).toBe("t1")
  })

  test("提交时尺寸转星号 + 带 X-DashScope-Async 头", async () => {
    let captured: any
    const fetchImpl = (async (url: string, init?: any) => {
      if (String(url).includes("image-synthesis")) {
        captured = { headers: init.headers, body: JSON.parse(init.body) }
        return res(200, { output: { task_id: "t", task_status: "PENDING" } })
      }
      return res(200, { output: { task_status: "SUCCEEDED", results: [{ url: "u" }] } })
    }) as unknown as typeof fetch

    await generateImage({ apiKey: "k", prompt: "p", size: "1024x1024", fetchImpl, pollIntervalMs: 1 })
    expect(captured.headers["X-DashScope-Async"]).toBe("enable")
    expect(captured.body.parameters.size).toBe("1024*1024")
  })

  test("FAILED + DataInspectionFailed → 中文审核驳回文案", async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("image-synthesis")) return res(200, { output: { task_id: "t", task_status: "PENDING" } })
      return res(200, { output: { task_status: "FAILED", code: "DataInspectionFailed", message: "blocked" } })
    }) as unknown as typeof fetch

    const p = generateImage({ apiKey: "k", prompt: "p", fetchImpl, pollIntervalMs: 1 })
    await expect(p).rejects.toThrow(/审核/)
  })

  test("HTTP 401 → auth_failed", async () => {
    const fetchImpl = (async () => res(401, { message: "bad key" })) as unknown as typeof fetch
    try {
      await generateImage({ apiKey: "k", prompt: "p", fetchImpl, pollIntervalMs: 1 })
      throw new Error("应当抛错")
    } catch (e) {
      expect(e).toBeInstanceOf(DashScopeError)
      expect((e as DashScopeError).code).toBe("auth_failed")
    }
  })

  test("超过 maxWaitMs 仍未完成 → task_timeout", async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("image-synthesis")) return res(200, { output: { task_id: "t", task_status: "PENDING" } })
      return res(200, { output: { task_status: "RUNNING" } })
    }) as unknown as typeof fetch

    const p = generateImage({ apiKey: "k", prompt: "p", fetchImpl, pollIntervalMs: 1, maxWaitMs: 20 })
    await expect(p).rejects.toThrow(/超时/)
  })
})
