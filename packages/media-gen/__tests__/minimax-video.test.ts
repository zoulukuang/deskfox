// [feat: media-gen-minimax] 2026-05-28 — MiniMax 海螺视频(submit → poll → retrieve)单测
import { describe, expect, test } from "bun:test"
import { MinimaxError } from "../src/minimax-error"
import { generateVideo } from "../src/minimax-video"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe("minimax generateVideo", () => {
  test("submit → poll(Processing)→ Success → retrieve 返回 download_url", async () => {
    let pollCount = 0
    const calls: string[] = []
    const fetchImpl = (async (url: string, init?: any) => {
      const u = String(url)
      calls.push(`${init?.method ?? "GET"} ${u.replace(/\?.*/, "")}`)
      if (u.includes("/v1/video_generation") && init?.method === "POST") {
        return res(200, { base_resp: { status_code: 0 }, task_id: "task_abc" })
      }
      if (u.includes("/v1/query/video_generation")) {
        pollCount++
        if (pollCount < 2) return res(200, { base_resp: { status_code: 0 }, status: "Processing" })
        return res(200, { base_resp: { status_code: 0 }, status: "Success", file_id: "file_123" })
      }
      if (u.includes("/v1/files/retrieve")) {
        return res(200, { base_resp: { status_code: 0 }, file: { download_url: "https://cdn/x.mp4" } })
      }
      return res(404, {})
    }) as unknown as typeof fetch

    const out = await generateVideo({
      apiKey: "k",
      prompt: "一只奔跑的狐狸",
      fetchImpl,
      pollIntervalMs: 1,
      maxWaitMs: 5000,
    })
    expect(out.url).toBe("https://cdn/x.mp4")
    expect(out.taskId).toBe("task_abc")
    expect(out.fileId).toBe("file_123")
    expect(out.model).toBe("MiniMax-Hailuo-02")
    // 验调用次序:submit + poll×2 + retrieve
    expect(calls[0]).toContain("POST")
    expect(calls[0]).toContain("/v1/video_generation")
    expect(calls.filter((c) => c.includes("query")).length).toBe(2)
    expect(calls[calls.length - 1]).toContain("/v1/files/retrieve")
  })

  test("submit body 含 duration / resolution / first_frame_image(图生视频)", async () => {
    let submitBody: any
    const fetchImpl = (async (url: string, init?: any) => {
      const u = String(url)
      if (u.includes("/v1/video_generation") && init?.method === "POST") {
        submitBody = JSON.parse(init.body)
        return res(200, { base_resp: { status_code: 0 }, task_id: "t" })
      }
      if (u.includes("query")) return res(200, { base_resp: { status_code: 0 }, status: "Success", file_id: "f" })
      return res(200, { base_resp: { status_code: 0 }, file: { download_url: "u" } })
    }) as unknown as typeof fetch

    await generateVideo({
      apiKey: "k",
      prompt: "p",
      duration: 6,
      resolution: "768P",
      refImage: "data:image/png;base64,AAA",
      fetchImpl,
      pollIntervalMs: 1,
    })
    expect(submitBody.duration).toBe(6)
    expect(submitBody.resolution).toBe("768P")
    expect(submitBody.first_frame_image).toBe("data:image/png;base64,AAA")
  })

  test("poll 看到 Fail → 抛 video_fail 错误(带 status_msg)", async () => {
    const fetchImpl = (async (url: string, init?: any) => {
      if (String(url).includes("/v1/video_generation") && init?.method === "POST") return res(200, { base_resp: { status_code: 0 }, task_id: "t" })
      if (String(url).includes("query"))
        return res(200, { base_resp: { status_code: 0 }, status: "Fail", status_msg: "content blocked" })
      return res(200, {})
    }) as unknown as typeof fetch

    const p = generateVideo({ apiKey: "k", prompt: "p", fetchImpl, pollIntervalMs: 1, maxWaitMs: 5000 })
    await expect(p).rejects.toThrow(/视频生成失败|content blocked/)
  })

  test("submit 1008 余额不足 → MinimaxError 友好文案", async () => {
    const fetchImpl = (async () => res(200, { base_resp: { status_code: 1008, status_msg: "balance" } })) as unknown as typeof fetch
    const p = generateVideo({ apiKey: "k", prompt: "p", fetchImpl, pollIntervalMs: 1 })
    await expect(p).rejects.toThrow(/余额不足|订阅套餐失效/)
    await expect(p).rejects.toBeInstanceOf(MinimaxError)
  })

  test("超时(maxWaitMs)→ task_timeout 错误", async () => {
    const fetchImpl = (async (url: string, init?: any) => {
      if (String(url).includes("/v1/video_generation") && init?.method === "POST") return res(200, { base_resp: { status_code: 0 }, task_id: "t" })
      // 永远 Processing
      return res(200, { base_resp: { status_code: 0 }, status: "Processing" })
    }) as unknown as typeof fetch

    const p = generateVideo({ apiKey: "k", prompt: "p", fetchImpl, pollIntervalMs: 1, maxWaitMs: 50 })
    await expect(p).rejects.toThrow(/超时|task_timeout/)
  })

  test("Success 但 file_id 缺失 → no_file_id 错误", async () => {
    const fetchImpl = (async (url: string, init?: any) => {
      if (String(url).includes("/v1/video_generation") && init?.method === "POST") return res(200, { base_resp: { status_code: 0 }, task_id: "t" })
      return res(200, { base_resp: { status_code: 0 }, status: "Success" })
    }) as unknown as typeof fetch

    const p = generateVideo({ apiKey: "k", prompt: "p", fetchImpl, pollIntervalMs: 1, maxWaitMs: 5000 })
    await expect(p).rejects.toThrow(/无 file_id|no_file_id/)
  })
})
