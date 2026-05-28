// [feat: media-gen-xiaomi] 2026-05-28 — Omni 当 ASR(mimo-v2.5)单测
import { describe, expect, test } from "bun:test"
import { writeFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { transcribeAudio } from "../src/xiaomi-asr"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

function makeWav(): string {
  const path = join(tmpdir(), `xiaomi-asr-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.wav`)
  writeFileSync(path, Buffer.from("FAKE WAV"))
  return path
}

describe("transcribeAudio", () => {
  test("成功路径:input_audio 多模态消息 + text content 返回", async () => {
    const wav = makeWav()
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { content: "你好，我是小米 MiMo。" } }] })
    }) as unknown as typeof fetch

    const out = await transcribeAudio({ apiKey: "k", audioUrl: wav, fetchImpl })

    // 关键断言:走 mimo-v2.5(Omni),不是 mimo-v2.5-asr(probe 实测 Token Plan 没暴露 asr 直 model)
    expect(captured.model).toBe("mimo-v2.5")
    // 多模态消息:user content 是数组
    expect(Array.isArray(captured.messages[0].content)).toBe(true)
    const parts = captured.messages[0].content
    expect(parts.find((p: any) => p.type === "text")).toBeDefined()
    const audioPart = parts.find((p: any) => p.type === "input_audio")
    expect(audioPart).toBeDefined()
    expect(audioPart.input_audio.format).toBe("wav")
    expect(typeof audioPart.input_audio.data).toBe("string")
    expect(audioPart.input_audio.data.length).toBeGreaterThan(0)

    // 输出
    expect(out.text).toBe("你好，我是小米 MiMo。")
    expect(out.model).toBe("mimo-v2.5")

    unlinkSync(wav)
  })

  test("自定义 instruction 透传到 text part", async () => {
    const wav = makeWav()
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { content: "x" } }] })
    }) as unknown as typeof fetch
    await transcribeAudio({ apiKey: "k", audioUrl: wav, instruction: "请翻译成英文,不要原文。", fetchImpl })
    const textPart = captured.messages[0].content.find((p: any) => p.type === "text")
    expect(textPart.text).toBe("请翻译成英文,不要原文。")
    unlinkSync(wav)
  })

  test(".mp3 文件 → input_audio.format = mp3", async () => {
    const mp3 = join(tmpdir(), `xiaomi-asr-${Date.now()}.mp3`)
    writeFileSync(mp3, Buffer.from("ID3 FAKE"))
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { content: "x" } }] })
    }) as unknown as typeof fetch
    await transcribeAudio({ apiKey: "k", audioUrl: mp3, fetchImpl })
    const audioPart = captured.messages[0].content.find((p: any) => p.type === "input_audio")
    expect(audioPart.input_audio.format).toBe("mp3")
    unlinkSync(mp3)
  })

  test("文件不存在 → audio_not_found", async () => {
    const fetchImpl = (async () => res(200, {})) as unknown as typeof fetch
    await expect(transcribeAudio({ apiKey: "k", audioUrl: "/no/such.wav", fetchImpl })).rejects.toThrow(/音频文件不存在/)
  })

  test("文件 > 7MB → audio_too_large 预检拦", async () => {
    const big = join(tmpdir(), `xiaomi-asr-big-${Date.now()}.wav`)
    writeFileSync(big, Buffer.alloc(8 * 1024 * 1024))
    const fetchImpl = (async () => res(200, {})) as unknown as typeof fetch
    await expect(transcribeAudio({ apiKey: "k", audioUrl: big, fetchImpl })).rejects.toThrow(/音频文件过大|< 7MB/)
    unlinkSync(big)
  })

  test("content 缺失 → no_text 错误", async () => {
    const wav = makeWav()
    const fetchImpl = (async () => res(200, { choices: [{ message: {} }] })) as unknown as typeof fetch
    await expect(transcribeAudio({ apiKey: "k", audioUrl: wav, fetchImpl })).rejects.toThrow(/没返回文本内容/)
    unlinkSync(wav)
  })
})
