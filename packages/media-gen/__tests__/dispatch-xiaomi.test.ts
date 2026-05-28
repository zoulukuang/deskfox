// [feat: media-gen-xiaomi] 2026-05-28 — dispatch by-provider 路由 XIAOMI_KEY 单测
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { runEntry } from "../src/dispatch"
import { findEntry } from "../src/registry"
import { BUILTIN_CATALOG, XIAOMI_KEY } from "../src/catalog"

function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const FAKE_B64 = Buffer.from([1, 2, 3, 4]).toString("base64")

function makeAuthJson(): string {
  const dir = join(tmpdir(), `media-gen-xiaomi-dispatch-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, "auth.json")
  writeFileSync(
    p,
    JSON.stringify({
      "xiaomi-token-plan-cn": { type: "api", key: "tp-fake-test-key" },
    }),
  )
  return p
}

describe("runEntry → 小米 MiMo 路由", () => {
  test("xiaomi tts 条目 → 调 token-plan-cn 端点 + api-key header(不是 Bearer)", async () => {
    const authPath = makeAuthJson()
    let hitUrl = ""
    let hitHeaders: any = {}
    const fetchImpl = (async (url: string, init: any) => {
      hitUrl = String(url)
      hitHeaders = init.headers
      return res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "wav" } } }] })
    }) as unknown as typeof fetch

    const entry = findEntry("xiaomi-mimo-v2.5-tts", { authPath })
    expect(entry).toBeDefined()
    const out = await runEntry(entry!, { prompt: "你好", voice: "茉莉", fetchImpl }, { authPath })

    expect(hitUrl).toContain("token-plan-cn.xiaomimimo.com")
    expect(hitHeaders["api-key"]).toBe("tp-fake-test-key")
    expect(hitHeaders.Authorization).toBeUndefined()
    expect(out.kind).toBe("audio")
    expect(out.url?.startsWith("file://")).toBe(true)
    expect(out.provider).toBe("小米 MiMo")
    unlinkSync(fileURLToPath(out.url!))
    rmSync(authPath, { force: true })
  })

  test("xiaomi tts_clone:refFile 传 → audio.voice 是 DataURL", async () => {
    const authPath = makeAuthJson()
    // 临时参考音频
    const refPath = join(tmpdir(), `xiaomi-disp-ref-${Date.now()}.wav`)
    writeFileSync(refPath, Buffer.from("FAKE WAV"))
    let bodyCaptured: any
    const fetchImpl = (async (_url: string, init: any) => {
      bodyCaptured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "wav" } } }] })
    }) as unknown as typeof fetch

    const entry = findEntry("xiaomi-mimo-v2.5-tts-voiceclone", { authPath })
    expect(entry).toBeDefined()
    const out = await runEntry(entry!, { prompt: "克隆这段", refFile: refPath, fetchImpl }, { authPath })

    expect(bodyCaptured.audio.voice).toMatch(/^data:audio\/wav;base64,/)
    expect(bodyCaptured.model).toBe("mimo-v2.5-tts-voiceclone")
    expect(out.url?.startsWith("file://")).toBe(true)
    unlinkSync(refPath)
    unlinkSync(fileURLToPath(out.url!))
    rmSync(authPath, { force: true })
  })

  test("xiaomi tts_clone 没传 refFile / audioUrl → no_ref XiaomiError", async () => {
    const authPath = makeAuthJson()
    const fetchImpl = (async () => res(200, {})) as unknown as typeof fetch
    const entry = findEntry("xiaomi-mimo-v2.5-tts-voiceclone", { authPath })
    await expect(runEntry(entry!, { prompt: "x", fetchImpl }, { authPath })).rejects.toThrow(/参考音频/)
    rmSync(authPath, { force: true })
  })

  test("xiaomi tts_design:voiceDesignHint 传 → user message 是描述,audio 不含 voice", async () => {
    const authPath = makeAuthJson()
    let bodyCaptured: any
    const fetchImpl = (async (_url: string, init: any) => {
      bodyCaptured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { audio: { data: FAKE_B64, format: "wav" } } }] })
    }) as unknown as typeof fetch

    const entry = findEntry("xiaomi-mimo-v2.5-tts-voicedesign", { authPath })
    const out = await runEntry(entry!, { prompt: "请这样说", voiceDesignHint: "中年男声沉稳", fetchImpl }, { authPath })

    expect(bodyCaptured.messages[0].content).toBe("中年男声沉稳")
    expect(bodyCaptured.audio.voice).toBeUndefined()
    expect("voice" in bodyCaptured.audio).toBe(false)
    unlinkSync(fileURLToPath(out.url!))
    rmSync(authPath, { force: true })
  })

  test("xiaomi tts_design 没传 voiceDesignHint → no_design_hint", async () => {
    const authPath = makeAuthJson()
    const fetchImpl = (async () => res(200, {})) as unknown as typeof fetch
    const entry = findEntry("xiaomi-mimo-v2.5-tts-voicedesign", { authPath })
    await expect(runEntry(entry!, { prompt: "x", fetchImpl }, { authPath })).rejects.toThrow(/声线描述/)
    rmSync(authPath, { force: true })
  })

  test("xiaomi asr:audioUrl 传 → input_audio multimodal,返回 text", async () => {
    const authPath = makeAuthJson()
    const refPath = join(tmpdir(), `xiaomi-disp-asr-${Date.now()}.wav`)
    writeFileSync(refPath, Buffer.from("FAKE WAV"))
    let bodyCaptured: any
    const fetchImpl = (async (_url: string, init: any) => {
      bodyCaptured = JSON.parse(init.body)
      return res(200, { choices: [{ message: { content: "你好" } }] })
    }) as unknown as typeof fetch

    const entry = findEntry("xiaomi-mimo-v2.5-asr", { authPath })
    const out = await runEntry(entry!, { audioUrl: refPath, fetchImpl }, { authPath })

    expect(bodyCaptured.model).toBe("mimo-v2.5") // Omni,不是 mimo-v2.5-asr
    expect(Array.isArray(bodyCaptured.messages[0].content)).toBe(true)
    const audioPart = bodyCaptured.messages[0].content.find((p: any) => p.type === "input_audio")
    expect(audioPart).toBeDefined()
    expect(out.kind).toBe("text")
    expect(out.text).toBe("你好")
    unlinkSync(refPath)
    rmSync(authPath, { force: true })
  })

  test("没读到 xiaomi key → no_key XiaomiError", async () => {
    // 给一个空 auth.json + 直接从 BUILTIN_CATALOG 取条目(findEntry 会被 auth filter 滤掉)
    const dir = join(tmpdir(), `media-gen-xiaomi-empty-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const authPath = join(dir, "auth.json")
    writeFileSync(authPath, JSON.stringify({}))
    const fetchImpl = (async () => res(200, {})) as unknown as typeof fetch
    const entry = BUILTIN_CATALOG.find((e) => e.providerKey === XIAOMI_KEY && e.capability === "tts")
    expect(entry).toBeDefined()
    await expect(runEntry(entry!, { prompt: "x", fetchImpl }, { authPath })).rejects.toThrow(/未找到.*API Key/)
    rmSync(authPath, { force: true })
  })
})
