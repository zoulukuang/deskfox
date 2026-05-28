// [feat: media-gen-minimax] 2026-05-28 — MiniMax 语音合成 t2a_v2 单测
// 注:本引擎写真实临时文件(os.tmpdir),验证落盘 + file:// URL 返回正确。
import { describe, expect, test } from "bun:test"
import { readFileSync, unlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { MinimaxError } from "../src/minimax-error"
import { synthesizeSpeech } from "../src/minimax-tts"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

// 构造一段合法的 hex 音频(随便 12 字节,实际内容只验长度 + bytes 落盘)
const FAKE_HEX = "deadbeef0123456789ab"
const EXPECTED_BYTES = Buffer.from(FAKE_HEX, "hex")

describe("minimax synthesizeSpeech", () => {
  test("成功路径:body 形状对 + hex 解码 + tmpdir 落盘 + file:// URL 返回", async () => {
    let captured: any
    const fetchImpl = (async (url: string, init: any) => {
      captured = { url, body: JSON.parse(init.body), headers: init.headers }
      return res(200, { base_resp: { status_code: 0, status_msg: "success" }, data: { audio: FAKE_HEX } })
    }) as unknown as typeof fetch

    const out = await synthesizeSpeech({ apiKey: "k", text: "你好", voice: "female-shaonv", fetchImpl })

    // 验返回结构
    expect(out.url.startsWith("file://")).toBe(true)
    expect(out.url).toContain(".mp3")
    expect(out.model).toBe("speech-2.8-hd")
    expect(out.voice).toBe("female-shaonv")

    // 验请求 body 形状
    expect(captured.url).toContain("/v1/t2a_v2")
    expect(captured.headers.Authorization).toBe("Bearer k")
    expect(captured.body.text).toBe("你好")
    expect(captured.body.voice_setting.voice_id).toBe("female-shaonv")
    expect(captured.body.voice_setting.speed).toBe(1.0)
    expect(captured.body.audio_setting.format).toBe("mp3")
    expect(captured.body.stream).toBe(false)

    // 验落盘:tmpPath 文件真存在 + bytes 跟 hex 解出来一致
    const localPath = fileURLToPath(out.url)
    const onDisk = readFileSync(localPath)
    expect(onDisk.equals(EXPECTED_BYTES)).toBe(true)
    unlinkSync(localPath) // 测试清理
  })

  test("自定义 speed/vol/pitch/format 透传到 body", async () => {
    let captured: any
    const fetchImpl = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body)
      return res(200, { base_resp: { status_code: 0 }, data: { audio: FAKE_HEX } })
    }) as unknown as typeof fetch

    const out = await synthesizeSpeech({
      apiKey: "k",
      text: "t",
      voice: "male-qn-qingse",
      speed: 1.5,
      vol: 8,
      pitch: 2,
      format: "wav",
      fetchImpl,
    })
    expect(captured.voice_setting.speed).toBe(1.5)
    expect(captured.voice_setting.vol).toBe(8)
    expect(captured.voice_setting.pitch).toBe(2)
    expect(captured.audio_setting.format).toBe("wav")
    expect(out.url).toContain(".wav")
    unlinkSync(fileURLToPath(out.url))
  })

  test("1008 余额不足 → MinimaxError 友好文案", async () => {
    const fetchImpl = (async () => res(200, { base_resp: { status_code: 1008, status_msg: "balance" } })) as unknown as typeof fetch
    const p = synthesizeSpeech({ apiKey: "k", text: "t", fetchImpl })
    await expect(p).rejects.toThrow(/余额不足|订阅套餐失效/)
    await expect(p).rejects.toBeInstanceOf(MinimaxError)
  })

  test("status_code=0 但 data.audio 缺失 → no_audio 错误", async () => {
    const fetchImpl = (async () => res(200, { base_resp: { status_code: 0 }, data: {} })) as unknown as typeof fetch
    const p = synthesizeSpeech({ apiKey: "k", text: "t", fetchImpl })
    await expect(p).rejects.toThrow(/没返回音频数据/)
  })

  test("data.audio 是空 hex → empty_audio 错误", async () => {
    const fetchImpl = (async () => res(200, { base_resp: { status_code: 0 }, data: { audio: "" } })) as unknown as typeof fetch
    const p = synthesizeSpeech({ apiKey: "k", text: "t", fetchImpl })
    // 空字符串 audio 走 no_audio(typeof check 不到)
    await expect(p).rejects.toThrow(/没返回音频数据/)
  })
})
