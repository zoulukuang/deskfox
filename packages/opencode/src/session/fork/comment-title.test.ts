// REQ-125 · 2026-09-17 · [feat: release-closeout-2026-09]
// ensureTitle 注入层:只动 user 消息里的引用注释样板,其余一律原样。

import { describe, expect, test } from "bun:test"
import { formatCommentNote } from "@opencode-ai/core/fork/comment-note"
import { unwrapCommentNotesForTitle } from "./comment-title"

const fileNote = formatCommentNote({ path: "src/parser.ts", comment: "这段解析逻辑有 bug 吗?" })
const chatNote = formatCommentNote({
  path: "<chat selection>",
  comment: "按这个处理吧",
  preview: "上一轮助手说的那段",
  kind: "chat",
})

describe("unwrapCommentNotesForTitle", () => {
  test("string content:文件引用样板被剥掉", () => {
    const [msg] = unwrapCommentNotesForTitle([{ role: "user", content: fileNote }])
    expect(msg.content).toContain("这段解析逻辑有 bug 吗?")
    expect(msg.content).not.toContain("The user made the following comment")
  })

  test("string content:聊天引用样板被剥掉", () => {
    const [msg] = unwrapCommentNotesForTitle([{ role: "user", content: chatNote }])
    expect(msg.content).toBe("按这个处理吧")
  })

  test("数组 content:只动 text part,其余 part 原样", () => {
    const image = { type: "image", image: "data:..." }
    const [msg] = unwrapCommentNotesForTitle([
      { role: "user", content: [{ type: "text", text: fileNote }, image] },
    ])
    const parts = msg.content as { type: string; text?: string }[]
    expect(parts[0].text).toContain("这段解析逻辑有 bug 吗?")
    expect(parts[0].text).not.toContain("The user made the following comment")
    expect(parts[1]).toBe(image)
  })

  test("普通 user 消息原样透传 —— 不该误伤非引用消息", () => {
    const original = { role: "user", content: "帮我写个排序函数" }
    const [msg] = unwrapCommentNotesForTitle([original])
    expect(msg.content).toBe("帮我写个排序函数")
  })

  test("assistant 消息一个字不动(即便内容碰巧像模板)", () => {
    const original = { role: "assistant", content: fileNote }
    const [msg] = unwrapCommentNotesForTitle([original])
    expect(msg).toBe(original)
    expect(msg.content).toBe(fileNote)
  })

  test("多条消息:逐条处理,顺序不变", () => {
    const result = unwrapCommentNotesForTitle([
      { role: "user", content: fileNote },
      { role: "assistant", content: "好的" },
      { role: "user", content: chatNote },
    ])
    expect(result).toHaveLength(3)
    expect(result[0].content).toContain("这段解析逻辑有 bug 吗?")
    expect(result[1].content).toBe("好的")
    expect(result[2].content).toBe("按这个处理吧")
  })

  test("空数组 / 畸形消息不炸", () => {
    expect(unwrapCommentNotesForTitle([])).toEqual([])
    expect(unwrapCommentNotesForTitle([{} as never])).toHaveLength(1)
    expect(unwrapCommentNotesForTitle([{ role: "user" } as never])).toHaveLength(1)
    expect(unwrapCommentNotesForTitle([{ role: "user", content: 42 } as never])).toHaveLength(1)
  })

  test("不改原数组(ensureTitle 之外的调用方拿到的 msgs 必须不受影响)", () => {
    const original = [{ role: "user", content: fileNote }]
    const snapshot = original[0].content
    unwrapCommentNotesForTitle(original)
    expect(original[0].content).toBe(snapshot)
  })
})
