// [feat: media-gen-xiaomi] 2026-05-28 — VoiceClone 单测
import { describe, expect, test } from "bun:test"
import { readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { cloneVoice } from "../src/xiaomi-tts-clone"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const FAKE_BYTES = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
const FAKE_B64 = FAKE_BYTES.toString("base64")

function makeRefWav(): string {
  const path = join(tmpdir(), `xiaomi-clone-ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.wav`)
  writeFileSync(path, Buffer.from("RIFF FAKE WAV BYTES FOR TEST"))
  return path
}

describe("cloneVoice", () => {
  test("成功路径:参考音频 → DataURL → audio.voice 字段(probe 实测的 DataURL 要求)", async () => {
    const refPath = makeRefWav()
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "wav" } } }] })
    }) as unknown as typeof fetch

    const out = await cloneVoice({ apiKey: "k", text: "克隆这段", refAudio: refPath, fetchImpl })

    // DataURL 形状(mime + base64 前缀)
    expect(captured.audio.voice).toMatch(/^data:audio\/wav;base64,/)
    // model 锁定
    expect(captured.model).toBe("mimo-v2.5-tts-voiceclone")
    // messages[user] 是空字符串(VoiceClone 不需要 style hint),messages[assistant] 是待合成文本
    expect(captured.messages[0].role).toBe("user")
    expect(captured.messages[0].content).toBe("")
    expect(captured.messages[1].content).toBe("克隆这段")

    expect(out.url.startsWith("file://")).toBe(true)
    unlinkSync(refPath)
    unlinkSync(fileURLToPath(out.url))
  })

  test(".mp3 参考音频 → mime audio/mpeg", async () => {
    const refPath = join(tmpdir(), `xiaomi-ref-${Date.now()}.mp3`)
    writeFileSync(refPath, Buffer.from("ID3 FAKE MP3"))
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "wav" } } }] })
    }) as unknown as typeof fetch

    const out = await cloneVoice({ apiKey: "k", text: "t", refAudio: refPath, fetchImpl })
    expect(captured.audio.voice).toMatch(/^data:audio\/mpeg;base64,/)
    unlinkSync(refPath)
    unlinkSync(fileURLToPath(out.url))
  })

  test("file:// URL 也接受(loadRefAudio fileURLToPath 分支)", async () => {
    const refPath = makeRefWav()
    const fileUrl = pathToFileURL(refPath).href
    const fetchImpl = (async () => res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "wav" } } }] })) as unknown as typeof fetch
    const out = await cloneVoice({ apiKey: "k", text: "t", refAudio: fileUrl, fetchImpl })
    expect(out.url.startsWith("file://")).toBe(true)
    unlinkSync(refPath)
    unlinkSync(fileURLToPath(out.url))
  })

  test("文件不存在 → ref_not_found", async () => {
    const fetchImpl = (async () => res(200, {})) as unknown as typeof fetch
    await expect(cloneVoice({ apiKey: "k", text: "t", refAudio: "/no/such/file.wav", fetchImpl })).rejects.toThrow(/参考音频不存在/)
  })

  test("文件 > 7MB(safety margin)→ ref_too_large 预检拦", async () => {
    const refPath = join(tmpdir(), `xiaomi-big-${Date.now()}.wav`)
    writeFileSync(refPath, Buffer.alloc(8 * 1024 * 1024)) // 8MB
    const fetchImpl = (async () => res(200, {})) as unknown as typeof fetch
    await expect(cloneVoice({ apiKey: "k", text: "t", refAudio: refPath, fetchImpl })).rejects.toThrow(/参考音频过大|≤10MB|< 7MB/)
    unlinkSync(refPath)
  })

  test("http:// URL → fetch 拉 bytes(记录所有 fetch URL,验下载 + chat 两次都打)", async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(String(url))
      if (String(url).includes("example.com")) {
        return { ok: true, status: 200, arrayBuffer: async () => FAKE_BYTES.buffer.slice(FAKE_BYTES.byteOffset, FAKE_BYTES.byteOffset + FAKE_BYTES.byteLength) } as unknown as Response
      }
      return res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "wav" } } }] })
    }) as unknown as typeof fetch
    const out = await cloneVoice({ apiKey: "k", text: "t", refAudio: "https://example.com/ref.wav", fetchImpl })
    expect(urls.some((u) => u.includes("example.com/ref.wav"))).toBe(true)
    expect(urls.some((u) => u.includes("/chat/completions"))).toBe(true)
    unlinkSync(fileURLToPath(out.url))
  })
})
