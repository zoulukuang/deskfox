import { describe, expect, test } from "bun:test"
import type { Prompt } from "@/context/prompt"
import { buildRequestParts } from "./build-request-parts"

describe("buildRequestParts", () => {
  test("builds typed request and optimistic parts without cast path", () => {
    const prompt: Prompt = [
      { type: "text", content: "hello", start: 0, end: 5 },
      {
        type: "file",
        path: "src/foo.ts",
        content: "@src/foo.ts",
        start: 5,
        end: 16,
        selection: { startLine: 4, startChar: 1, endLine: 6, endChar: 1 },
      },
      { type: "agent", name: "planner", content: "@planner", start: 16, end: 24 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [{ key: "ctx:1", type: "file", path: "src/bar.ts", comment: "check this" }],
      images: [
        { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
      ],
      text: "hello @src/foo.ts @planner",
      messageID: "msg_1",
      sessionID: "ses_1",
      sessionDirectory: "/repo",
    })

    expect(result.requestParts[0]?.type).toBe("text")
    expect(result.requestParts.some((part) => part.type === "agent")).toBe(true)
    expect(
      result.requestParts.some((part) => part.type === "file" && part.url.startsWith("file:///repo/src/foo.ts")),
    ).toBe(true)
    expect(result.requestParts.some((part) => part.type === "text" && part.synthetic)).toBe(true)
    expect(
      result.requestParts.some(
        (part) =>
          part.type === "text" &&
          part.synthetic &&
          part.metadata?.opencodeComment &&
          (part.metadata.opencodeComment as { comment?: string }).comment === "check this",
      ),
    ).toBe(true)

    expect(result.optimisticParts).toHaveLength(result.requestParts.length)
    expect(result.optimisticParts.every((part) => part.sessionID === "ses_1" && part.messageID === "msg_1")).toBe(true)
  })

  test("keeps multiple uploaded attachments in order", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "check these", start: 0, end: 11 }],
      context: [],
      images: [
        { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
        {
          type: "image",
          id: "img_2",
          filename: "b.pdf",
          mime: "application/pdf",
          dataUrl: "data:application/pdf;base64,BBB",
        },
      ],
      text: "check these",
      messageID: "msg_multi",
      sessionID: "ses_multi",
      sessionDirectory: "/repo",
    })

    const files = result.requestParts.filter((part) => part.type === "file" && part.url.startsWith("data:"))

    expect(files).toHaveLength(2)
    expect(files.map((part) => (part.type === "file" ? part.filename : ""))).toEqual(["a.png", "b.pdf"])
  })

  test("preserves an external attachment source path for the model", () => {
    const result = buildRequestParts({
      prompt: [],
      context: [],
      images: [
        {
          type: "image",
          id: "img_external",
          filename: "opencode.global.dat",
          sourcePath: "C:\\Users\\Luke\\AppData\\Roaming\\ai.opencode.desktop.beta\\opencode.global.dat",
          mime: "text/plain",
          dataUrl: "data:text/plain;base64,AAA",
        },
      ],
      text: "inspect this",
      messageID: "msg_external",
      sessionID: "ses_external",
      sessionDirectory: "C:\\Repos\\sst\\opencode",
    })

    expect(result.requestParts.find((part) => part.type === "file")?.filename).toBe(
      "C:\\Users\\Luke\\AppData\\Roaming\\ai.opencode.desktop.beta\\opencode.global.dat",
    )
  })

  test("preserves reference aliases as directory file parts", () => {
    const result = buildRequestParts({
      prompt: [
        {
          type: "file",
          path: "/repo/../docs",
          content: "@docs",
          start: 0,
          end: 5,
          mime: "application/x-directory",
          filename: "docs",
        },
      ],
      context: [],
      images: [],
      text: "@docs",
      messageID: "msg_reference",
      sessionID: "ses_reference",
      sessionDirectory: "/repo/app",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      expect(filePart.mime).toBe("application/x-directory")
      expect(filePart.filename).toBe("docs")
      expect(filePart.url).toBe("file:///repo/../docs")
      expect(filePart.source?.type).toBe("file")
      if (filePart.source?.type === "file") {
        expect(filePart.source.path).toBe("/repo/../docs")
        expect(filePart.source.text.value).toBe("@docs")
      }
    }
  })

  test("deduplicates context files when prompt already includes same path", () => {
    const prompt: Prompt = [{ type: "file", path: "src/foo.ts", content: "@src/foo.ts", start: 0, end: 11 }]

    const result = buildRequestParts({
      prompt,
      context: [
        { key: "ctx:dup", type: "file", path: "src/foo.ts" },
        { key: "ctx:comment", type: "file", path: "src/foo.ts", comment: "focus here" },
      ],
      images: [],
      text: "@src/foo.ts",
      messageID: "msg_2",
      sessionID: "ses_2",
      sessionDirectory: "/repo",
    })

    const fooFiles = result.requestParts.filter(
      (part) => part.type === "file" && part.url.startsWith("file:///repo/src/foo.ts"),
    )
    const synthetic = result.requestParts.filter((part) => part.type === "text" && part.synthetic)

    expect(fooFiles).toHaveLength(2)
    expect(synthetic).toHaveLength(1)
  })

  test("adds file parts for @mentions inside comment text", () => {
    const result = buildRequestParts({
      prompt: [{ type: "text", content: "look", start: 0, end: 4 }],
      context: [
        {
          key: "ctx:comment-mention",
          type: "file",
          path: "src/review.ts",
          comment: "Compare with @src/shared.ts and @src/review.ts.",
        },
      ],
      images: [],
      text: "look",
      messageID: "msg_comment_mentions",
      sessionID: "ses_comment_mentions",
      sessionDirectory: "/repo",
    })

    const files = result.requestParts.filter((part) => part.type === "file")
    expect(files).toHaveLength(2)
    expect(files.some((part) => part.type === "file" && part.url === "file:///repo/src/review.ts")).toBe(true)
    expect(files.some((part) => part.type === "file" && part.url === "file:///repo/src/shared.ts")).toBe(true)
  })

  test("handles Windows paths correctly (simulated on macOS)", () => {
    const prompt: Prompt = [{ type: "file", path: "src\\foo.ts", content: "@src\\foo.ts", start: 0, end: 11 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src\\foo.ts",
      messageID: "msg_win_1",
      sessionID: "ses_win_1",
      sessionDirectory: "D:\\projects\\myapp", // Windows path
    })

    // Should create valid file URLs
    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should not have encoded backslashes in wrong place
      expect(filePart.url).not.toContain("%5C")
      // Should have normalized to forward slashes
      expect(filePart.url).toContain("/src/foo.ts")
    }
  })

  test("handles Windows absolute path with special characters", () => {
    const prompt: Prompt = [{ type: "file", path: "file#name.txt", content: "@file#name.txt", start: 0, end: 14 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@file#name.txt",
      messageID: "msg_win_2",
      sessionID: "ses_win_2",
      sessionDirectory: "C:\\Users\\test\\Documents", // Windows path
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Special chars should be encoded
      expect(filePart.url).toContain("file%23name.txt")
      // Should have Windows drive letter properly encoded
      expect(filePart.url).toMatch(/file:\/\/\/[A-Z]:/)
    }
  })

  test("handles Linux absolute paths correctly", () => {
    const prompt: Prompt = [{ type: "file", path: "src/app.ts", content: "@src/app.ts", start: 0, end: 10 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src/app.ts",
      messageID: "msg_linux_1",
      sessionID: "ses_linux_1",
      sessionDirectory: "/home/user/project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should be a normal Unix path
      expect(filePart.url).toBe("file:///home/user/project/src/app.ts")
    }
  })

  test("handles macOS paths correctly", () => {
    const prompt: Prompt = [{ type: "file", path: "README.md", content: "@README.md", start: 0, end: 9 }]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@README.md",
      messageID: "msg_mac_1",
      sessionID: "ses_mac_1",
      sessionDirectory: "/Users/kelvin/Projects/opencode",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // URL should be parseable
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should be a normal Unix path
      expect(filePart.url).toBe("file:///Users/kelvin/Projects/opencode/README.md")
    }
  })

  test("handles context files with Windows paths", () => {
    const prompt: Prompt = []

    const result = buildRequestParts({
      prompt,
      context: [
        { key: "ctx:1", type: "file", path: "src\\utils\\helper.ts" },
        { key: "ctx:2", type: "file", path: "test\\unit.test.ts", comment: "check tests" },
      ],
      images: [],
      text: "test",
      messageID: "msg_win_ctx",
      sessionID: "ses_win_ctx",
      sessionDirectory: "D:\\workspace\\app",
    })

    const fileParts = result.requestParts.filter((part) => part.type === "file")
    expect(fileParts).toHaveLength(2)

    // All file URLs should be valid
    fileParts.forEach((part) => {
      if (part.type === "file") {
        expect(() => new URL(part.url)).not.toThrow()
        expect(part.url).not.toContain("%5C") // No encoded backslashes
      }
    })
  })

  test("handles absolute Windows paths (user manually specifies full path)", () => {
    const prompt: Prompt = [
      { type: "file", path: "D:\\other\\project\\file.ts", content: "@D:\\other\\project\\file.ts", start: 0, end: 25 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@D:\\other\\project\\file.ts",
      messageID: "msg_abs",
      sessionID: "ses_abs",
      sessionDirectory: "C:\\current\\project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should handle absolute path that differs from sessionDirectory
      expect(() => new URL(filePart.url)).not.toThrow()
      expect(filePart.url).toContain("/D:/other/project/file.ts")
    }
  })

  test("handles selection with query parameters on Windows", () => {
    const prompt: Prompt = [
      {
        type: "file",
        path: "src\\App.tsx",
        content: "@src\\App.tsx",
        start: 0,
        end: 11,
        selection: { startLine: 10, startChar: 0, endLine: 20, endChar: 5 },
      },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@src\\App.tsx",
      messageID: "msg_sel",
      sessionID: "ses_sel",
      sessionDirectory: "C:\\project",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should have query parameters
      expect(filePart.url).toContain("?start=10&end=20")
      // Should be valid URL
      expect(() => new URL(filePart.url)).not.toThrow()
      // Query params should parse correctly
      const url = new URL(filePart.url)
      expect(url.searchParams.get("start")).toBe("10")
      expect(url.searchParams.get("end")).toBe("20")
    }
  })

  // FORK: REQ-065 — 同文件多张选区卡(相同 url、不同 commentID)必须全部提交,不被旧的"按 url 去重"误并
  test("keeps multiple same-path selection cards distinguished by commentID", () => {
    const result = buildRequestParts({
      prompt: [],
      context: [
        { key: "ctx:c1", type: "file", path: "src/a.ts", selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 0 }, commentID: "c1", preview: "alpha" },
        { key: "ctx:c2", type: "file", path: "src/a.ts", selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 0 }, commentID: "c2", preview: "beta" },
        { key: "ctx:c3", type: "file", path: "src/a.ts", selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 0 }, commentID: "c3", preview: "gamma" },
      ],
      images: [],
      text: "go",
      messageID: "msg_multi_card",
      sessionID: "ses_multi_card",
      sessionDirectory: "/repo",
    })

    const fileParts = result.requestParts.filter((part) => part.type === "file")
    const synthetic = result.requestParts.filter((part) => part.type === "text" && part.synthetic)
    // 三张卡 url 相同,仅 commentID 不同 → 仍各自保留(修前只会留 1 张)
    expect(fileParts).toHaveLength(3)
    expect(synthetic).toHaveLength(3)
  })

  // FORK: REQ-065 / md-token — 无评论的选区卡也要把"选中文字 preview"送达模型,不退化为整文件
  test("selection card without comment still delivers preview text (md token fix)", () => {
    const result = buildRequestParts({
      prompt: [],
      context: [
        { key: "ctx:p", type: "file", path: "docs/big.md", selection: { startLine: 10, startChar: 0, endLine: 20, endChar: 0 }, commentID: "q1", preview: "the selected paragraph" },
      ],
      images: [],
      text: "explain",
      messageID: "msg_preview",
      sessionID: "ses_preview",
      sessionDirectory: "/repo",
    })

    const synthetic = result.requestParts.filter((part) => part.type === "text" && part.synthetic)
    expect(synthetic).toHaveLength(1)
    expect(synthetic.some((part) => part.type === "text" && part.text.includes("the selected paragraph"))).toBe(true)
    // 仍带行范围的 file url
    expect(
      result.requestParts.some((part) => part.type === "file" && part.url.includes("?start=10&end=20")),
    ).toBe(true)
  })

  // FORK: REQ-065 — 选区卡既无评论又无 preview:无可发内容 → 退化为单 file part(但不被去重丢掉)
  test("commentID card without comment or preview degrades to file part only", () => {
    const result = buildRequestParts({
      prompt: [],
      context: [{ key: "ctx:empty", type: "file", path: "src/a.ts", commentID: "e1" }],
      images: [],
      text: "go",
      messageID: "msg_empty",
      sessionID: "ses_empty",
      sessionDirectory: "/repo",
    })

    expect(result.requestParts.filter((part) => part.type === "file")).toHaveLength(1)
    expect(result.requestParts.filter((part) => part.type === "text" && part.synthetic)).toHaveLength(0)
  })

  // FORK: REQ-065 — commentID 卡在前不应污染 url 去重集:其后同路径的整文件裸卡仍应保留
  test("commentID card before a bare whole-file card does not swallow it", () => {
    const result = buildRequestParts({
      prompt: [],
      context: [
        { key: "ctx:c", type: "file", path: "src/a.ts", commentID: "c1", preview: "x" },
        { key: "ctx:bare", type: "file", path: "src/a.ts" },
      ],
      images: [],
      text: "go",
      messageID: "msg_order",
      sessionID: "ses_order",
      sessionDirectory: "/repo",
    })

    // commentID 卡(text+file)+ 裸整文件卡(file)→ 共 2 个 file part
    expect(result.requestParts.filter((part) => part.type === "file")).toHaveLength(2)
  })

  test("handles file paths with dots and special segments on Windows", () => {
    const prompt: Prompt = [
      { type: "file", path: "..\\..\\shared\\util.ts", content: "@..\\..\\shared\\util.ts", start: 0, end: 21 },
    ]

    const result = buildRequestParts({
      prompt,
      context: [],
      images: [],
      text: "@..\\..\\shared\\util.ts",
      messageID: "msg_dots",
      sessionID: "ses_dots",
      sessionDirectory: "C:\\projects\\myapp\\src",
    })

    const filePart = result.requestParts.find((part) => part.type === "file")
    expect(filePart).toBeDefined()
    if (filePart?.type === "file") {
      // Should be valid URL
      expect(() => new URL(filePart.url)).not.toThrow()
      // Should preserve .. segments (backend normalizes)
      expect(filePart.url).toContain("/..")
    }
  })
})
