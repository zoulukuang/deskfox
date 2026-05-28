// [feat: media-gen-xiaomi] 2026-05-28 — 小米 MiMo 错误处理单测
import { describe, expect, test } from "bun:test"
import { XiaomiError, checkErrorResp, httpError } from "../src/xiaomi-error"

describe("XiaomiError", () => {
  test("instanceof + 字段透传", () => {
    const e = new XiaomiError("400", "测试", { raw: 1 }, "audio.voice")
    expect(e).toBeInstanceOf(XiaomiError)
    expect(e.code).toBe("400")
    expect(e.message).toBe("测试")
    expect(e.param).toBe("audio.voice")
  })
})

describe("checkErrorResp", () => {
  test("无 error 字段 → noop 返回 void", () => {
    expect(() => checkErrorResp({ choices: [{}] })).not.toThrow()
    expect(() => checkErrorResp({})).not.toThrow()
  })

  test("VoiceDesign 误填 voice 的 param 关键词 → 友好文案命中", () => {
    const json = { error: { code: "400", message: "Param Incorrect", param: "audio.voice is not supported for voice design model" } }
    expect(() => checkErrorResp(json)).toThrow(/VoiceDesign 模型不支持指定预设音色/)
  })

  test("VoiceClone 裸 base64 的 param 关键词 → 友好文案命中", () => {
    const json = { error: { code: "400", message: "Param Incorrect", param: "audio.voice must be a DataURL for voice clone model" } }
    expect(() => checkErrorResp(json)).toThrow(/DataURL/)
  })

  test("Not supported model → 友好文案", () => {
    const json = { error: { code: "400", message: "Param Incorrect", param: "Not supported model mimo-v2.5-asr" } }
    expect(() => checkErrorResp(json)).toThrow(/未在 Token Plan 暴露/)
  })

  test("401 → 鉴权失败文案", () => {
    const json = { error: { code: "401", message: "Unauthorized" } }
    expect(() => checkErrorResp(json)).toThrow(/鉴权失败/)
  })

  test("429 → 频率超限文案", () => {
    const json = { error: { code: "429", message: "Too many requests" } }
    expect(() => checkErrorResp(json)).toThrow(/频率超限/)
  })

  test("未知 code + 无 param 关键词 → 兜底原始 code+msg", () => {
    const json = { error: { code: "9999", message: "unknown weirdness" } }
    expect(() => checkErrorResp(json)).toThrow(/9999.*unknown weirdness/)
  })

  test("抛出的是 XiaomiError(instanceof)而非普通 Error", () => {
    const json = { error: { code: "400", message: "x" } }
    try {
      checkErrorResp(json)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(XiaomiError)
    }
  })
})

describe("httpError", () => {
  test("HTTP 401 → 鉴权失败 XiaomiError", () => {
    const e = httpError(401, {})
    expect(e).toBeInstanceOf(XiaomiError)
    expect(e.code).toBe("auth_failed")
    expect(e.message).toMatch(/鉴权失败|无效/)
  })

  test("HTTP 429 → rate_limit", () => {
    const e = httpError(429, {})
    expect(e.code).toBe("rate_limit")
  })

  test("HTTP 400 带 body.error → 走 checkErrorResp 同一路径(优先级)", () => {
    const e = httpError(400, { error: { code: "400", message: "Param Incorrect", param: "audio.voice is not supported for voice design model" } })
    expect(e.message).toMatch(/VoiceDesign 模型不支持/)
    expect(e.param).toBe("audio.voice is not supported for voice design model")
  })

  test("HTTP 500 无 error body → 兜底 http_500", () => {
    const e = httpError(500, { weird: 1 })
    expect(e.code).toBe("http_500")
  })
})
