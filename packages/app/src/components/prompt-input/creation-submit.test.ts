// FORK: 创作模式提交编排单测(Logic 清单)[feat: media-creation-mode]
// [bug-repro: v2 composer 默认后创作模式送单路径缺失 — upstream-sync-2026-08 验收发现]
import { describe, expect, test } from "bun:test"
import type { ContentPart } from "@/context/prompt"
import { resolveReferenceImage, submitCreation, type CreationSubmitContext } from "./creation-submit"

const textPart = (content: string): ContentPart => ({ type: "text", content }) as ContentPart
const imagePart = (url: string): ContentPart =>
  ({ type: "image", blob: { url }, filename: "ref.png", mime: "image/png" }) as unknown as ContentPart

function ctx(overrides: Partial<CreationSubmitContext> = {}, calls: Record<string, unknown[]> = {}) {
  const base: CreationSubmitContext = {
    creation: {
      selectedModel: () => ({ id: "model-1" }),
      currentVoice: () => "voice-a",
      voiceDesignHint: () => "低沉男声",
      runCreation: async (entry, input, dir) => {
        calls.run = [entry, input, dir]
        return undefined
      },
    },
    parts: () => [textPart("画一只狐狸")],
    projectDir: () => "D:/proj",
    reset: () => {
      calls.reset = [true]
    },
    resolveImage: async () => undefined,
    ...overrides,
  }
  return base
}

describe("submitCreation", () => {
  test("无可用模型 → 不受理,不清空输入框", async () => {
    const calls: Record<string, unknown[]> = {}
    const c = ctx({ creation: { ...ctx({}, calls).creation, selectedModel: () => undefined } }, calls)
    expect(await submitCreation("image", c)).toBe(false)
    expect(calls.reset).toBeUndefined()
    expect(calls.run).toBeUndefined()
  })

  test("正常送单 → 受理、先清空、runCreation 收到项目目录", async () => {
    const calls: Record<string, unknown[]> = {}
    const c = ctx({}, calls)
    expect(await submitCreation("image", c)).toBe(true)
    expect(calls.reset).toEqual([true])
    const [, input, dir] = calls.run as [unknown, { prompt: string }, string]
    expect(input.prompt).toBe("画一只狐狸")
    expect(dir).toBe("D:/proj")
  })

  test("tts 带音色 / tts_design 带声线描述 / 其他 capability 都不带", async () => {
    const calls: Record<string, unknown[]> = {}
    await submitCreation("tts", ctx({}, calls))
    expect((calls.run as [unknown, { voice?: string }])[1].voice).toBe("voice-a")

    await submitCreation("tts_design", ctx({}, calls))
    expect((calls.run as [unknown, { voiceDesignHint?: string }])[1].voiceDesignHint).toBe("低沉男声")

    await submitCreation("image", ctx({}, calls))
    const input = (calls.run as [unknown, { voice?: string; voiceDesignHint?: string }])[1]
    expect(input.voice).toBeUndefined()
    expect(input.voiceDesignHint).toBeUndefined()
  })

  test("translate 固定 targetLang=English", async () => {
    const calls: Record<string, unknown[]> = {}
    await submitCreation("translate", ctx({}, calls))
    expect((calls.run as [unknown, { targetLang?: string }])[1].targetLang).toBe("English")
  })
})

describe("resolveReferenceImage", () => {
  const deps = {
    fetchBlob: async () => new Blob(["x"]),
    readAsDataUrl: async () => "data:image/png;base64,AAA",
  }

  test("image_edit 有图片附件 → 解成 dataUrl", async () => {
    expect(await resolveReferenceImage([imagePart("blob:1")], "image_edit", deps)).toBe("data:image/png;base64,AAA")
  })

  test("video_i2v 同样解", async () => {
    expect(await resolveReferenceImage([imagePart("blob:1")], "video_i2v", deps)).toBe("data:image/png;base64,AAA")
  })

  test("非参考图类 capability → 不解(省一次 fetch)", async () => {
    expect(await resolveReferenceImage([imagePart("blob:1")], "image", deps)).toBeUndefined()
  })

  test("没有图片附件 → undefined", async () => {
    expect(await resolveReferenceImage([textPart("hi")], "image_edit", deps)).toBeUndefined()
  })

  test("blob 读取失败 → 吞掉返回 undefined(不阻断送单)", async () => {
    const failing = { fetchBlob: async () => Promise.reject(new Error("gone")), readAsDataUrl: deps.readAsDataUrl }
    expect(await resolveReferenceImage([imagePart("blob:1")], "image_edit", failing)).toBeUndefined()
  })
})
