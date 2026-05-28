// [feat: media-gen-xiaomi] 2026-05-28 — 统一 chat-completions POST helper 单测
import { describe, expect, test } from "bun:test"
import { extractAudio, extractText, postChatCompletion } from "../src/xiaomi-chat"
import { XiaomiError } from "../src/xiaomi-error"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

describe("postChatCompletion", () => {
  test("auth header 是 api-key(不是 Authorization: Bearer)", async () => {
    let captured: any
    const fetchImpl = (async (url: string, init: any) => {
      captured = { url, headers: init.headers, body: JSON.parse(init.body) }
      return res(200, { choices: [{ message: { content: "ok" } }] })
    }) as unknown as typeof fetch
    await postChatCompletion({ apiKey: "tp-test", model: "mimo-v2.5", messages: [{ role: "user", content: "hi" }], fetchImpl })
    expect(captured.headers["api-key"]).toBe("tp-test")
    expect(captured.headers.Authorization).toBeUndefined()
    expect(captured.headers["Content-Type"]).toBe("application/json")
  })

  test("body 包含 model + messages + audio(可选)", async () => {
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { audio: { data: "AAA", format: "wav" } } }] })
    }) as unknown as typeof fetch
    await postChatCompletion({
      apiKey: "k",
      model: "mimo-v2.5-tts",
      messages: [
        { role: "user", content: "style" },
        { role: "assistant", content: "text" },
      ],
      audio: { format: "wav", voice: "茉莉" },
      fetchImpl,
    })
    expect(captured.model).toBe("mimo-v2.5-tts")
    expect(captured.messages).toHaveLength(2)
    expect(captured.audio.format).toBe("wav")
    expect(captured.audio.voice).toBe("茉莉")
  })

  test("baseUrl 注入(走 token-plan-cn 而非按量计费 host)", async () => {
    let hitUrl = ""
    const fetchImpl = (async (url: string) => {
      hitUrl = String(url)
      return res(200, { choices: [{ message: { content: "x" } }] })
    }) as unknown as typeof fetch
    await postChatCompletion({
      apiKey: "k",
      model: "mimo-v2.5",
      messages: [{ role: "user", content: "x" }],
      fetchImpl,
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    })
    expect(hitUrl).toBe("https://token-plan-cn.xiaomimimo.com/v1/chat/completions")
  })

  test("HTTP 400 + body.error → XiaomiError 带 param", async () => {
    const fetchImpl = (async () => res(400, { error: { code: "400", message: "Param Incorrect", param: "audio.voice must be a DataURL for voice clone model" } })) as unknown as typeof fetch
    const p = postChatCompletion({ apiKey: "k", model: "mimo-v2.5-tts-voiceclone", messages: [{ role: "user", content: "" }], fetchImpl })
    await expect(p).rejects.toBeInstanceOf(XiaomiError)
    await expect(p).rejects.toThrow(/DataURL/)
  })

  test("HTTP 200 但 body.error 也抛(业务错误也可能 200)", async () => {
    const fetchImpl = (async () => res(200, { error: { code: "429", message: "rate" } })) as unknown as typeof fetch
    const p = postChatCompletion({ apiKey: "k", model: "mimo-v2.5", messages: [{ role: "user", content: "x" }], fetchImpl })
    await expect(p).rejects.toThrow(/频率超限/)
  })

  test("network throw → XiaomiError code=network", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED")
    }) as unknown as typeof fetch
    const p = postChatCompletion({ apiKey: "k", model: "mimo-v2.5", messages: [{ role: "user", content: "x" }], fetchImpl })
    await expect(p).rejects.toBeInstanceOf(XiaomiError)
    try {
      await p
    } catch (e: any) {
      expect(e.code).toBe("network")
      expect(e.message).toMatch(/网络错误|ECONNREFUSED/)
    }
  })
})

describe("extractAudio", () => {
  test("正常路径:choices[0].message.audio.data → { data, format }", () => {
    const out = extractAudio({ choices: [{ message: { audio: { data: "BASE64DATA", format: "wav" } } }] })
    expect(out.data).toBe("BASE64DATA")
    expect(out.format).toBe("wav")
  })

  test("format 缺失 → 默认 wav", () => {
    const out = extractAudio({ choices: [{ message: { audio: { data: "X" } } }] })
    expect(out.format).toBe("wav")
  })

  test("audio.data 空字符串 → XiaomiError no_audio", () => {
    expect(() => extractAudio({ choices: [{ message: { audio: { data: "" } } }] })).toThrow(/没返回音频数据/)
  })

  test("audio 字段缺失 → XiaomiError no_audio", () => {
    expect(() => extractAudio({ choices: [{ message: {} }] })).toThrow(/没返回音频数据/)
  })
})

describe("extractText", () => {
  test("正常路径:string content → 直接返", () => {
    expect(extractText({ choices: [{ message: { content: "hello" } }] })).toBe("hello")
  })

  test("多模态数组:抽 type=text 拼接", () => {
    const out = extractText({
      choices: [{ message: { content: [{ type: "text", text: "line1" }, { type: "text", text: "line2" }, { type: "other" }] } }],
    })
    expect(out).toBe("line1\nline2")
  })

  test("content 缺失 → no_text", () => {
    expect(() => extractText({ choices: [{ message: {} }] })).toThrow(/没返回文本内容/)
  })
})
