import { describe, expect, test } from "bun:test"
import type { ContentPart } from "@/context/prompt"
import { absolutePath, buildCreationInput, type CreationCapability } from "./creation-input"

// 工具:简洁构造 parts
const text = (s: string): ContentPart => ({ type: "text", content: s, start: 0, end: s.length })
const file = (path: string): ContentPart => ({ type: "file", path, content: "@" + path, start: 0, end: ("@" + path).length })
const agent = (name: string): ContentPart => ({ type: "agent", name, content: "@" + name, start: 0, end: ("@" + name).length })
const imagePart = (dataUrl: string): ContentPart => ({
  type: "image",
  id: "img-1",
  filename: "a.png",
  mime: "image/png",
  dataUrl,
})

const PROJECT = "D:\\文章库"

const build = (parts: ContentPart[], capability: CreationCapability, opts: Partial<Parameters<typeof buildCreationInput>[0]> = {}) =>
  buildCreationInput({ parts, capability, projectDir: PROJECT, ...opts })

describe("absolutePath", () => {
  test("相对路径拼上 projectDir", () => {
    expect(absolutePath(PROJECT, "creations/img.png")).toBe("D:\\文章库/creations/img.png")
  })

  test("已是 Win 绝对路径,idempotent 不动", () => {
    expect(absolutePath(PROJECT, "D:\\foo\\bar.png")).toBe("D:\\foo\\bar.png")
    expect(absolutePath(PROJECT, "D:/foo/bar.png")).toBe("D:/foo/bar.png")
  })

  test("已是 POSIX 绝对路径不动", () => {
    expect(absolutePath(PROJECT, "/usr/share/x")).toBe("/usr/share/x")
  })

  test("UNC 路径不动", () => {
    expect(absolutePath(PROJECT, "\\\\server\\share\\x")).toBe("\\\\server\\share\\x")
  })

  test("projectDir 末尾斜杠不重复", () => {
    expect(absolutePath(PROJECT + "\\", "creations/img.png")).toBe("D:\\文章库/creations/img.png")
    expect(absolutePath(PROJECT + "/", "creations/img.png")).toBe("D:\\文章库/creations/img.png")
  })
})

describe("buildCreationInput — bug-repro: 创作模式 @<路径> 没塞进 refFile/audioUrl", () => {
  test("image_edit + @<path> file part → refFile 是绝对路径,prompt 不含 @<path> 字面", () => {
    const parts = [file("creations/images/m00in.png"), text(" 加个红色斗篷")]
    const input = build(parts, "image_edit")
    expect(input.refFile).toBe("D:\\文章库/creations/images/m00in.png")
    expect(input.prompt).toBe("加个红色斗篷")
    expect(input.prompt).not.toContain("@")
  })

  test("asr + @<path> file part → audioUrl 是绝对路径(本 bug 主战场)", () => {
    const parts = [file("creations/audio/x.wav")]
    const input = build(parts, "asr")
    expect(input.audioUrl).toBe("D:\\文章库/creations/audio/x.wav")
    expect(input.refFile).toBeUndefined()
  })

  test("video_i2v + @<path> file part → refFile 是绝对路径", () => {
    const parts = [file("creations/images/firstframe.png"), text(" 让她笑起来")]
    const input = build(parts, "video_i2v")
    expect(input.refFile).toBe("D:\\文章库/creations/images/firstframe.png")
    expect(input.prompt).toBe("让她笑起来")
  })

  test("image_edit 没文件 → refFile undefined(dispatcher 报友好错)", () => {
    const input = build([text("加个斗篷")], "image_edit")
    expect(input.refFile).toBeUndefined()
    expect(input.prompt).toBe("加个斗篷")
  })

  test("asr 没文件 → audioUrl undefined", () => {
    const input = build([], "asr")
    expect(input.audioUrl).toBeUndefined()
  })
})

describe("buildCreationInput — 向后兼容 + 边界", () => {
  test("image_edit + base64 附件(旧 +号 通道)→ refFile = dataUrl(不破坏既有行为)", () => {
    const parts = [imagePart("data:image/png;base64,AAA"), text("加斗篷")]
    const input = build(parts, "image_edit")
    expect(input.refFile).toBe("data:image/png;base64,AAA")
  })

  test("image_edit + file part + base64 附件并存 → file part 优先(用户显式 @ 引用意图更明确)", () => {
    const parts = [file("creations/a.png"), imagePart("data:image/png;base64,AAA"), text("加斗篷")]
    const input = build(parts, "image_edit")
    expect(input.refFile).toBe("D:\\文章库/creations/a.png")
  })

  test("多个 @<path> file part → 取第一个", () => {
    const parts = [file("a.png"), file("b.png"), text("编辑")]
    const input = build(parts, "image_edit")
    expect(input.refFile).toBe("D:\\文章库/a.png")
  })

  test("image(文生图)+ @<path> file part → file 忽略(纯文生图不要图),prompt 仍剔除 @ 字面", () => {
    const parts = [file("ref.png"), text("画一只狐狸")]
    const input = build(parts, "image")
    expect(input.refFile).toBeUndefined()
    expect(input.prompt).toBe("画一只狐狸")
  })

  test("tts + voice → input.voice 设置", () => {
    const input = build([text("你好")], "tts", { voice: "Cherry" })
    expect(input.voice).toBe("Cherry")
    expect(input.prompt).toBe("你好")
  })

  test("translate + targetLang → input.targetLang 设置", () => {
    const input = build([text("Hello")], "translate", { targetLang: "Chinese" })
    expect(input.targetLang).toBe("Chinese")
  })

  test("agent part(@<name>)的字面 NOT 进 prompt", () => {
    const parts = [agent("imbot"), text(" 帮我画狐狸")]
    const input = build(parts, "image")
    expect(input.prompt).toBe("帮我画狐狸")
    expect(input.prompt).not.toContain("@imbot")
  })

  test("file part 是绝对路径时 absolutePath 不双拼", () => {
    const parts = [file("D:\\已绝对\\img.png"), text("编辑")]
    const input = build(parts, "image_edit")
    expect(input.refFile).toBe("D:\\已绝对\\img.png")
  })
})
