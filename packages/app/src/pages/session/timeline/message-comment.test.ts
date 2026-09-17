// [bug-repro: 选中文字「加入聊天」提交后,消息流里的引用卡片只剩「<chat selection> + 我补的那句话」,
//              引文原文一个字都看不到;tooltip 也只是把注释重复一遍 —— 内容没丢,是渲染层自己扔的]
// REQ-131 · 2026-09-17 · [feat: release-closeout-2026-09]
//
// 断点在 MessageComment.fromPart:它原先只挑 path/comment/selection 三项,
// preview(引文原文)与 kind(chat/file)当场丢弃,后面三层再想显示也无米下锅。
// 数据链本身是齐的:createCommentMetadata 写入 → readCommentMetadata 读回。

import { describe, expect, test } from "bun:test"
import { MessageComment } from "./message-comment"
import { createCommentMetadata, formatCommentNote } from "@/utils/comment-note"

type Part = Parameters<typeof MessageComment.fromPart>[0]

function syntheticPart(input: {
  path: string
  comment: string
  preview?: string
  kind?: "chat" | "file"
  selection?: { startLine: number; startChar: number; endLine: number; endChar: number }
}): Part {
  return {
    type: "text",
    synthetic: true,
    text: formatCommentNote(input),
    metadata: createCommentMetadata(input),
  } as unknown as Part
}

describe("MessageComment.fromPart · 引文回看", () => {
  test("聊天引用:preview 与 kind 都要接上 —— 本条就是 REQ-131 的复现", () => {
    const result = MessageComment.fromPart(
      syntheticPart({
        path: "<chat selection>",
        comment: "按这个处理吧",
        preview: "上一轮助手说的那段原文",
        kind: "chat",
      }),
    )
    expect(result?.preview).toBe("上一轮助手说的那段原文")
    expect(result?.kind).toBe("chat")
    expect(result?.comment).toBe("按这个处理吧")
  })

  test("文件引用:preview 同样要接上(REQ-131 影响面不止聊天引用)", () => {
    const result = MessageComment.fromPart(
      syntheticPart({
        path: "src/parser.ts",
        comment: "这段有 bug 吗?",
        preview: "function parse() {}",
        kind: "file",
        selection: { startLine: 10, startChar: 0, endLine: 12, endChar: 0 },
      }),
    )
    expect(result?.preview).toBe("function parse() {}")
    expect(result?.kind).toBe("file")
    expect(result?.selection).toEqual({ startLine: 10, endLine: 12 })
  })

  test("多行引文原样带回,不在这一层截断(截断是卡片的事)", () => {
    const preview = "第一行\n第二行\n第三行"
    const result = MessageComment.fromPart(
      syntheticPart({ path: "<chat selection>", comment: "看这里", preview, kind: "chat" }),
    )
    expect(result?.preview).toBe(preview)
  })

  test("老消息(无 metadata,走文本回退解析)→ preview/kind 为 undefined,不抛", () => {
    const legacy = {
      type: "text",
      synthetic: true,
      text: formatCommentNote({ path: "src/a.ts", comment: "老注释" }),
      metadata: undefined,
    } as unknown as Part
    const result = MessageComment.fromPart(legacy)
    expect(result?.path).toBe("src/a.ts")
    expect(result?.comment).toBe("老注释")
    expect(result?.preview).toBeUndefined()
    expect(result?.kind).toBeUndefined()
  })

  test("非 synthetic / 非 text part 一律不认", () => {
    expect(MessageComment.fromPart({ type: "text", synthetic: false, text: "hi" } as unknown as Part)).toBeUndefined()
    expect(MessageComment.fromPart({ type: "file", synthetic: true } as unknown as Part)).toBeUndefined()
  })

  test("既非评论元数据也不匹配模板 → undefined", () => {
    expect(
      MessageComment.fromPart({ type: "text", synthetic: true, text: "随便一段话" } as unknown as Part),
    ).toBeUndefined()
  })
})
