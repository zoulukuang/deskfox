// [bug-repro: 发送失败回吐引用卡片时漏传 kind,聊天引用(kind:"chat")降级成文件引用,
//              再次发送时 formatCommentNote 走错模板,"引文来自本次对话"的语义静默丢失]
// REQ-100 ④ · 2026-09-17 · [feat: release-closeout-2026-09]

import { describe, expect, test } from "bun:test"
import { commentRestorePayload, type CommentRestoreInput } from "./comment-restore"

const chatQuote: CommentRestoreInput = {
  path: "<chat selection>",
  selection: undefined,
  comment: "按这个处理吧",
  commentID: "cmt_1",
  commentOrigin: "quote",
  preview: "上一轮助手说的那段原文",
  kind: "chat",
}

const fileQuote: CommentRestoreInput = {
  path: "src/parser.ts",
  selection: { startLine: 10, startChar: 0, endLine: 12, endChar: 0 },
  comment: "这段解析逻辑有 bug 吗?",
  commentID: "cmt_2",
  commentOrigin: "file",
  preview: "function parse() {}",
  kind: "file",
}

describe("commentRestorePayload", () => {
  test("聊天引用回吐后 kind 仍是 chat —— 本条就是漏传 kind 的复现", () => {
    expect(commentRestorePayload(chatQuote).kind).toBe("chat")
  })

  test("文件引用各字段原样还原", () => {
    expect(commentRestorePayload(fileQuote)).toEqual({
      type: "file",
      path: "src/parser.ts",
      selection: { startLine: 10, startChar: 0, endLine: 12, endChar: 0 },
      comment: "这段解析逻辑有 bug 吗?",
      commentID: "cmt_2",
      commentOrigin: "file",
      preview: "function parse() {}",
      kind: "file",
    })
  })

  test("preview(引文原文)不得丢 —— 丢了用户回看就只剩一句注释", () => {
    expect(commentRestorePayload(chatQuote).preview).toBe("上一轮助手说的那段原文")
  })

  test("所有输入字段都有对应输出,一个不漏", () => {
    // 这条是"将来 ContextItem 加字段别忘了补"的看门狗:
    // 输入对象的每个 key(除内部用的 key/type)都应在输出里出现。
    const payload = commentRestorePayload(chatQuote) as Record<string, unknown>
    for (const field of Object.keys(chatQuote)) {
      expect(Object.hasOwn(payload, field)).toBe(true)
    }
  })

  test("可选字段缺席时不炸,也不凭空造值", () => {
    const minimal = commentRestorePayload({ path: "a.ts" } as CommentRestoreInput)
    expect(minimal.path).toBe("a.ts")
    expect(minimal.kind).toBeUndefined()
    expect(minimal.preview).toBeUndefined()
    expect(minimal.type).toBe("file")
  })
})
