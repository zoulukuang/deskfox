// [feat: media-gen-alibaba] 2026-05-26 — 视频/翻译/语音合成/语音识别 + 改图 单元测试(mock fetch)
import { describe, expect, test } from "bun:test"
import { rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { editImage } from "../src/dashscope-edit"
import { generateVideo } from "../src/dashscope-video"
import { synthesizeSpeech } from "../src/dashscope-tts"
import { translateText } from "../src/dashscope-translate"
import { transcribeAudio } from "../src/dashscope-asr"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe("editImage（qwen-image-edit）", () => {
  test("远程 url → multimodal-generation,取 content[].image", async () => {
    let body: any
    const fetchImpl = (async (_url: string, init?: any) => {
      body = JSON.parse(init.body)
      return res(200, { output: { choices: [{ message: { content: [{ image: "https://oss/edited.png" }] } }] } })
    }) as unknown as typeof fetch

    const out = await editImage({ apiKey: "k", prompt: "把背景换成绿色", image: "https://oss/base.png", fetchImpl })
    expect(out.url).toBe("https://oss/edited.png")
    expect(body.input.messages[0].content[0].image).toBe("https://oss/base.png")
    expect(body.input.messages[0].content[1].text).toBe("把背景换成绿色")
  })

  test("本地文件 → base64 data uri", async () => {
    const p = join(tmpdir(), `mg-edit-test-${Date.now()}.png`)
    writeFileSync(p, new Uint8Array([1, 2, 3, 4]))
    let body: any
    const fetchImpl = (async (_url: string, init?: any) => {
      body = JSON.parse(init.body)
      return res(200, { output: { choices: [{ message: { content: [{ image: "https://oss/e.png" }] } }] } })
    }) as unknown as typeof fetch

    const out = await editImage({ apiKey: "k", prompt: "x", image: p, fetchImpl })
    expect(out.url).toBe("https://oss/e.png")
    expect(String(body.input.messages[0].content[0].image)).toContain("data:image/png;base64,")
    rmSync(p)
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
