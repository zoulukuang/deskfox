// [feat: media-gen-xiaomi] 2026-05-28 — 标准 TTS(mimo-v2.5-tts)单测
import { describe, expect, test } from "bun:test"
import { readFileSync, unlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { synthesizeSpeech } from "../src/xiaomi-tts"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

// 12 字节 PCM 用作假音频
const FAKE_BYTES = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
const FAKE_B64 = FAKE_BYTES.toString("base64")

describe("synthesizeSpeech", () => {
  test("成功路径:body 形状对 + base64 解码 + tmpdir 落盘 + file:// URL 返回", async () => {
    let captured: any
    const fetchImpl = (async (url: string, init: any) => {
      captured = { url, body: JSON.parse(init.body), headers: init.headers }
      return res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "wav" } } }] })
    }) as unknown as typeof fetch

    const out = await synthesizeSpeech({ apiKey: "tp-k", text: "你好", voice: "茉莉", fetchImpl })

    expect(out.url.startsWith("file://")).toBe(true)
    expect(out.url).toContain(".wav")
    expect(out.model).toBe("mimo-v2.5-tts")
    expect(out.voice).toBe("茉莉")

    // body 形状
    expect(captured.url).toContain("/chat/completions")
    expect(captured.headers["api-key"]).toBe("tp-k") // 不是 Bearer!
    expect(captured.body.model).toBe("mimo-v2.5-tts")
    expect(captured.body.messages).toHaveLength(2)
    expect(captured.body.messages[0].role).toBe("user") // style hint
    expect(captured.body.messages[1].role).toBe("assistant")
    expect(captured.body.messages[1].content).toBe("你好")
    expect(captured.body.audio.format).toBe("wav")
    expect(captured.body.audio.voice).toBe("茉莉")

    // 落盘:tmpPath 文件存在 + bytes 跟 b64 解出来一致
    const localPath = fileURLToPath(out.url)
    const onDisk = readFileSync(localPath)
    expect(onDisk.equals(FAKE_BYTES)).toBe(true)
    unlinkSync(localPath)
  })

  test("自定义 styleHint 透传到 user message", async () => {
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "wav" } } }] })
    }) as unknown as typeof fetch

    const out = await synthesizeSpeech({ apiKey: "k", text: "t", styleHint: "兴奋的语气,语速快。", fetchImpl })
    expect(captured.messages[0].content).toBe("兴奋的语气,语速快。")
    unlinkSync(fileURLToPath(out.url))
  })

  test("自定义 voice / format 透传", async () => {
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "mp3" } } }] })
    }) as unknown as typeof fetch

    const out = await synthesizeSpeech({ apiKey: "k", text: "t", voice: "Chloe", format: "mp3", fetchImpl })
    expect(captured.audio.voice).toBe("Chloe")
    expect(captured.audio.format).toBe("mp3")
    expect(out.url).toContain(".mp3")
    unlinkSync(fileURLToPath(out.url))
  })

  test("HTTP 200 但 audio.data 缺失 → no_audio", async () => {
    const fetchImpl = (async () => res(200, { choices: [{ message: {} }] })) as unknown as typeof fetch
    await expect(synthesizeSpeech({ apiKey: "k", text: "t", fetchImpl })).rejects.toThrow(/没返回音频数据/)
  })

  test("HTTP 400 + body.error → 鉴权友好文案", async () => {
    const fetchImpl = (async () => res(401, { error: { code: "401", message: "Unauthorized" } })) as unknown as typeof fetch
    await expect(synthesizeSpeech({ apiKey: "bad", text: "t", fetchImpl })).rejects.toThrow(/鉴权失败/)
  })
})
