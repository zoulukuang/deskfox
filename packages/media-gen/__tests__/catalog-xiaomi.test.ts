// [feat: media-gen-xiaomi] 2026-05-28 — catalog 条目 + 新增 capability 类型回归测试
import { describe, expect, test } from "bun:test"
import { BUILTIN_CATALOG, CAPABILITY_LABEL, XIAOMI_KEY } from "../src/catalog"

describe("小米 MiMo catalog 条目", () => {
  test("XIAOMI_KEY 锁定为 'xiaomi-token-plan-cn'(对齐 user auth.json)", () => {
    expect(XIAOMI_KEY).toBe("xiaomi-token-plan-cn")
  })

  test("catalog 含 4 条小米条目:tts / tts_clone / tts_design / asr", () => {
    const xiaomi = BUILTIN_CATALOG.filter((e) => e.providerKey === XIAOMI_KEY)
    expect(xiaomi).toHaveLength(4)

    const byCap = new Map(xiaomi.map((e) => [e.capability, e]))
    expect(byCap.has("tts")).toBe(true)
    expect(byCap.has("tts_clone")).toBe(true)
    expect(byCap.has("tts_design")).toBe(true)
    expect(byCap.has("asr")).toBe(true)
  })

  test("4 个条目的 model id 与 probe 实测一致", () => {
    const get = (cap: string) => BUILTIN_CATALOG.find((e) => e.providerKey === XIAOMI_KEY && e.capability === cap)
    expect(get("tts")?.model).toBe("mimo-v2.5-tts")
    expect(get("tts_clone")?.model).toBe("mimo-v2.5-tts-voiceclone")
    expect(get("tts_design")?.model).toBe("mimo-v2.5-tts-voicedesign")
    expect(get("asr")?.model).toBe("mimo-v2.5") // Omni,不是 mimo-v2.5-asr(Token Plan 没暴露)
  })

  test("tts_clone needFile=audio(UI 知道要弹文件输入框)", () => {
    const e = BUILTIN_CATALOG.find((x) => x.providerKey === XIAOMI_KEY && x.capability === "tts_clone")
    expect(e?.params?.needFile).toBe("audio")
  })

  test("tts_design voiceDesignHint=true(UI 知道要弹声线描述输入框)", () => {
    const e = BUILTIN_CATALOG.find((x) => x.providerKey === XIAOMI_KEY && x.capability === "tts_design")
    expect(e?.params?.voiceDesignHint).toBe(true)
  })

  test("asr needFile=audio", () => {
    const e = BUILTIN_CATALOG.find((x) => x.providerKey === XIAOMI_KEY && x.capability === "asr")
    expect(e?.params?.needFile).toBe("audio")
  })

  test("tts 条目有 voices 列表(包含茉莉 / Chloe 等多语种音色)", () => {
    const e = BUILTIN_CATALOG.find((x) => x.providerKey === XIAOMI_KEY && x.capability === "tts")
    expect(e?.params?.voices).toBeDefined()
    expect(e?.params?.voices).toContain("茉莉")
    expect(e?.params?.voices).toContain("Chloe")
  })

  test("tts_clone / tts_design 是 capability 的唯一 isDefault(其他家没这两档)", () => {
    const clones = BUILTIN_CATALOG.filter((e) => e.capability === "tts_clone")
    const designs = BUILTIN_CATALOG.filter((e) => e.capability === "tts_design")
    expect(clones).toHaveLength(1)
    expect(designs).toHaveLength(1)
    expect(clones[0].isDefault).toBe(true)
    expect(designs[0].isDefault).toBe(true)
  })

  test("小米 tts/asr 不打 isDefault(让阿里更快的 paraformer-v2 / qwen-tts 保持默认)", () => {
    const tts = BUILTIN_CATALOG.find((x) => x.providerKey === XIAOMI_KEY && x.capability === "tts")
    const asr = BUILTIN_CATALOG.find((x) => x.providerKey === XIAOMI_KEY && x.capability === "asr")
    expect(tts?.isDefault).toBeUndefined()
    expect(asr?.isDefault).toBeUndefined()
  })
})

describe("新增 capability 类型 labels", () => {
  test("tts_clone label = 语音克隆", () => {
    expect(CAPABILITY_LABEL.tts_clone).toBe("语音克隆")
  })
  test("tts_design label = 语音设计", () => {
    expect(CAPABILITY_LABEL.tts_design).toBe("语音设计")
  })
  test("既有 label 对齐真 UI(CREATION_MODES):tts=语音合成 / asr=语音识别 [feat: catalog-capability-label-sync]", () => {
    expect(CAPABILITY_LABEL.image).toBe("文生图")
    expect(CAPABILITY_LABEL.tts).toBe("语音合成")
    expect(CAPABILITY_LABEL.asr).toBe("语音识别")
    expect(CAPABILITY_LABEL.translate).toBe("专业翻译")
  })
})
