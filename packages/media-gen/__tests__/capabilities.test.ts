// [feat: media-gen-alibaba] 2026-05-26 — 视频/翻译/语音合成/语音识别 + 改图 单元测试(mock fetch)
import { describe, expect, test } from "bun:test"
import { generateImage } from "../src/dashscope-image"
import { generateVideo } from "../src/dashscope-video"
import { synthesizeSpeech } from "../src/dashscope-tts"
import { translateText } from "../src/dashscope-translate"
import { transcribeAudio } from "../src/dashscope-asr"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe("generateImage 改图分支", () => {
  test("给 refImages 时走 image2image 端点 + description_edit", async () => {
    let captured: any
    const fetchImpl = (async (url: string, init?: any) => {
      if (init?.method === "POST") {
        captured = { url: String(url), body: JSON.parse(init.body) }
        return res(200, { output: { task_id: "t", task_status: "PENDING" } })
      }
      return res(200, { output: { task_status: "SUCCEEDED", results: [{ url: "https://oss/edited.png" }] } })
    }) as unknown as typeof fetch

    const out = await generateImage({
      apiKey: "k",
      prompt: "把背景换成雪山",
      refImages: ["https://oss/base.png"],
      fetchImpl,
      pollIntervalMs: 1,
    })
    expect(captured.url).toContain("image2image/image-synthesis")
    expect(captured.body.input.function).toBe("description_edit")
    expect(captured.body.input.base_image_url).toBe("https://oss/base.png")
    expect(out.urls).toEqual(["https://oss/edited.png"])
  })
})

describe("generateVideo", () => {
  test("文生视频取 output.video_url", async () => {
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("video-synthesis")) return res(200, { output: { task_id: "v", task_status: "PENDING" } })
      return res(200, { output: { task_status: "SUCCEEDED", video_url: "https://oss/clip.mp4" } })
    }) as unknown as typeof fetch
    const out = await generateVideo({ apiKey: "k", prompt: "狐狸跑步", fetchImpl, pollIntervalMs: 1 })
    expect(out.url).toBe("https://oss/clip.mp4")
  })

  test("给 refImage 时走 i2v(带 img_url)", async () => {
    let body: any
    const fetchImpl = (async (url: string, init?: any) => {
      if (init?.method === "POST") {
        body = JSON.parse(init.body)
        return res(200, { output: { task_id: "v", task_status: "PENDING" } })
      }
      return res(200, { output: { task_status: "SUCCEEDED", video_url: "https://oss/i2v.mp4" } })
    }) as unknown as typeof fetch
    await generateVideo({ apiKey: "k", prompt: "让它动", refImage: "https://oss/base.png", fetchImpl, pollIntervalMs: 1 })
    expect(body.input.img_url).toBe("https://oss/base.png")
    expect(body.model).toContain("i2v")
  })
})

describe("translateText", () => {
  test("取 choices[0].message.content", async () => {
    const fetchImpl = (async () =>
      res(200, { choices: [{ message: { content: "Hello world" } }] })) as unknown as typeof fetch
    const out = await translateText({ apiKey: "k", text: "你好世界", targetLang: "English", fetchImpl })
    expect(out.text).toBe("Hello world")
  })
})

describe("synthesizeSpeech", () => {
  test("取 output.audio.url", async () => {
    const fetchImpl = (async () =>
      res(200, { output: { audio: { url: "https://oss/voice.wav" } } })) as unknown as typeof fetch
    const out = await synthesizeSpeech({ apiKey: "k", text: "你好", fetchImpl })
    expect(out.url).toBe("https://oss/voice.wav")
  })
})

describe("transcribeAudio", () => {
  test("异步任务 → transcription_url → 二次拉取取文字", async () => {
    const fetchImpl = (async (url: string, init?: any) => {
      if (init?.method === "POST") return res(200, { output: { task_id: "a", task_status: "PENDING" } })
      if (String(url).includes("/tasks/"))
        return res(200, {
          output: { task_status: "SUCCEEDED", results: [{ transcription_url: "https://oss/t.json" }] },
        })
      // 转写 JSON 文件
      return res(200, { transcripts: [{ text: "你好世界" }] })
    }) as unknown as typeof fetch
    const out = await transcribeAudio({ apiKey: "k", audioUrl: "https://oss/a.wav", fetchImpl, pollIntervalMs: 1 })
    expect(out.text).toBe("你好世界")
  })
})
