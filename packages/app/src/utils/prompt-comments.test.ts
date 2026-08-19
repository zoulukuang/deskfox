import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2"
import { extractCommentsFromParts, quoteCommentID } from "./prompt-comments"

// FORK: REQ-123 — 撤回一条带引用的消息时,引用卡片必须保真回到输入框 2026-08-19
const CHAT_SELECTION_PATH = "<chat selection>"

function syntheticPart(id: string, text: string, metadata?: unknown): Part {
  return {
    id,
    type: "text",
    text,
    synthetic: true,
    metadata,
    sessionID: "ses_1",
    messageID: "msg_1",
  } as unknown as Part
}

function chatQuoteMeta(input: { comment: string; preview: string }) {
  return {
    opencodeComment: {
      path: CHAT_SELECTION_PATH,
      comment: input.comment,
      preview: input.preview,
      origin: "quote",
      kind: "chat",
    },
  }
}

describe("extractCommentsFromParts", () => {
  // T7 —— bug-repro 主线
  test("聊天引用的 synthetic part 还原成 FileContextItem(全字段)", () => {
    const parts = [
      syntheticPart(
        "part_1",
        'The user is quoting text from earlier in this conversation:\n"""\n引文\n"""\n\nTheir follow-up question/comment: 这段什么意思',
        chatQuoteMeta({ comment: "这段什么意思", preview: "引文" }),
      ),
    ]

    const items = extractCommentsFromParts(parts)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: "file",
      path: CHAT_SELECTION_PATH,
      comment: "这段什么意思",
      preview: "引文",
      commentOrigin: "quote",
      kind: "chat",
    })
    expect(items[0].commentID).toBeTruthy()
  })

  // T8
  test("非 synthetic 的正文 text part 不被误收", () => {
    const parts = [
      {
        id: "part_1",
        type: "text",
        text: "普通正文",
        sessionID: "ses_1",
        messageID: "msg_1",
      } as unknown as Part,
    ]
    expect(extractCommentsFromParts(parts)).toEqual([])
  })

  // T9
  test("无 metadata 的老消息走文本模板兜底", () => {
    const parts = [
      syntheticPart(
        "part_1",
        'The user made the following comment regarding lines 3 through 5 of src/a.ts: 看这里\n\nSelected text:\n"""\nconst a = 1\n"""',
      ),
    ]

    const items = extractCommentsFromParts(parts)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      path: "src/a.ts",
      comment: "看这里",
      commentOrigin: "quote",
    })
    expect(items[0].selection).toMatchObject({ startLine: 3, endLine: 5 })
  })

  // T10
  test("文件引用卡片同样还原,且带 selection", () => {
    const parts = [
      syntheticPart("part_1", "note", {
        opencodeComment: {
          path: "docs/a.md",
          comment: "这段改一下",
          preview: "标题",
          origin: "file",
          kind: "file",
          selection: { startLine: 2, startChar: 0, endLine: 4, endChar: 8 },
        },
      }),
    ]

    const items = extractCommentsFromParts(parts)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      path: "docs/a.md",
      commentOrigin: "file",
      kind: "file",
    })
    expect(items[0].selection).toMatchObject({ startLine: 2, startChar: 0, endLine: 4, endChar: 8 })
  })

  // T11
  test("review 行评论不还原(归 review 面板管)", () => {
    const parts = [
      syntheticPart("part_1", "note", {
        opencodeComment: {
          path: "src/a.ts",
          comment: "这里有 bug",
          origin: "review",
          selection: { startLine: 1, startChar: 0, endLine: 1, endChar: 0 },
        },
      }),
    ]
    expect(extractCommentsFromParts(parts)).toEqual([])
  })

  // T12
  test("同消息两条引用得到不同 ID;同一 part 反复调用 ID 稳定", () => {
    const parts = [
      syntheticPart("part_1", "a", chatQuoteMeta({ comment: "问题一", preview: "引文一" })),
      syntheticPart("part_2", "b", chatQuoteMeta({ comment: "问题二", preview: "引文二" })),
    ]

    const first = extractCommentsFromParts(parts)
    const second = extractCommentsFromParts(parts)

    expect(first).toHaveLength(2)
    expect(first[0].commentID).not.toBe(first[1].commentID)
    expect(first.map((x) => x.commentID)).toEqual(second.map((x) => x.commentID))
  })

  test("preview 相同但 part 不同 → ID 仍不同(dedup key 不塌缩)", () => {
    const same = { comment: "同样的问题", preview: "同样的引文" }
    const items = extractCommentsFromParts([
      syntheticPart("part_1", "a", chatQuoteMeta(same)),
      syntheticPart("part_2", "b", chatQuoteMeta(same)),
    ])
    expect(items[0].commentID).not.toBe(items[1].commentID)
  })

  test("kind 缺失的老聊天引用按伪路径推断为 chat", () => {
    const items = extractCommentsFromParts([
      syntheticPart("part_1", "a", {
        opencodeComment: { path: CHAT_SELECTION_PATH, comment: "问题", preview: "引文", origin: "quote" },
      }),
    ])
    expect(items[0].kind).toBe("chat")
  })

  // T13
  test("空输入 / 脏 metadata 不抛异常", () => {
    expect(extractCommentsFromParts(undefined)).toEqual([])
    expect(extractCommentsFromParts([])).toEqual([])
    expect(extractCommentsFromParts([syntheticPart("part_1", "无法解析的正文", { opencodeComment: 42 })])).toEqual([])
    expect(extractCommentsFromParts([syntheticPart("part_2", "", null)])).toEqual([])
  })
})

describe("quoteCommentID", () => {
  test("同 preview 同 suffix → 同 ID;换任一项 → 不同 ID", () => {
    expect(quoteCommentID("引文", "s1")).toBe(quoteCommentID("引文", "s1"))
    expect(quoteCommentID("引文", "s1")).not.toBe(quoteCommentID("引文", "s2"))
    expect(quoteCommentID("引文", "s1")).not.toBe(quoteCommentID("别的引文", "s1"))
  })

  test("空 preview 不抛异常", () => {
    expect(quoteCommentID("", "s1")).toStartWith("quote-")
  })
})
