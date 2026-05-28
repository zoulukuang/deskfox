// [feat: media-gen-xiaomi] 2026-05-28 — VoiceDesign 单测
// 关键回归点:audio object 不能含 voice 字段(否则 400 "audio.voice is not supported for voice design model")
import { describe, expect, test } from "bun:test"
import { unlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { designVoice } from "../src/xiaomi-tts-design"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const FAKE_B64 = Buffer.from([1, 2, 3, 4]).toString("base64")

describe("designVoice", () => {
  test("成功路径:audio object **不含** voice 字段(回归 probe 阶段的 'audio.voice is not supported' 报错)", async () => {
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "wav" } } }] })
    }) as unknown as typeof fetch

    const out = await designVoice({
      apiKey: "k",
      text: "请用我描述的声线说这句话。",
      voiceDescription: "中年男性,声音沉稳有磁性,像新闻主播。",
      fetchImpl,
    })

    // 关键断言:audio.voice 必须 undefined(不在对象里)
    expect(captured.audio.voice).toBeUndefined()
    expect("voice" in captured.audio).toBe(false)
    // format 应该有
    expect(captured.audio.format).toBe("wav")
    // model 锁定
    expect(captured.model).toBe("mimo-v2.5-tts-voicedesign")
    // 声线描述进 user message,文本进 assistant message
    expect(captured.messages[0].role).toBe("user")
    expect(captured.messages[0].content).toBe("中年男性,声音沉稳有磁性,像新闻主播。")
    expect(captured.messages[1].role).toBe("assistant")
    expect(captured.messages[1].content).toBe("请用我描述的声线说这句话。")

    expect(out.url.startsWith("file://")).toBe(true)
    expect(out.model).toBe("mimo-v2.5-tts-voicedesign")
    unlinkSync(fileURLToPath(out.url))
  })

  test("自定义 format=mp3 透传", async () => {
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "mp3" } } }] })
    }) as unknown as typeof fetch
    const out = await designVoice({ apiKey: "k", text: "t", voiceDescription: "d", format: "mp3", fetchImpl })
    expect(captured.audio.format).toBe("mp3")
    expect(out.url).toContain(".mp3")
    unlinkSync(fileURLToPath(out.url))
  })

  test("服务器异常时若仍误回 'audio.voice is not supported' → 友好文案", async () => {
    const fetchImpl = (async () => res(400, { error: { code: "400", message: "Param Incorrect", param: "audio.voice is not supported for voice design model" } })) as unknown as typeof fetch
    await expect(designVoice({ apiKey: "k", text: "t", voiceDescription: "d", fetchImpl })).rejects.toThrow(/VoiceDesign 模型不支持指定预设音色/)
  })
})
