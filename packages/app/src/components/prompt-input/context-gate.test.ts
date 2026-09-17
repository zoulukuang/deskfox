// [bug-repro-1: 文件预览区选中文字「加入聊天」后,不再输入任何文字就**无法提交** ——
//               而同样的动作在聊天区却能提交]
// [bug-repro-2: 消息发出去了,输入框下面仍留着那张「加入聊天」的卡片;更要紧的是它还在 context 里,
//               下一条消息会把同一个文件再发给模型一次,用户看不出来]
// 2026-09-17 · [feat: release-closeout-2026-09] · user 真机截图反馈

import { describe, expect, test } from "bun:test"
import { clearableContextItems, contextItemCount, type ContextGateItem } from "./context-gate"

const withComment = { type: "file", key: "a", comment: "这段什么意思" }
const noComment = { type: "file", key: "b" }
const placeholderComment = { type: "file", key: "c", comment: "(see selected text)" }
const image = { type: "image", key: "img" }

describe("contextItemCount · 提交闸", () => {
  test("无注释的选区卡也要计数(本条即 bug-repro-1:文件预览区纯引用发不出去)", () => {
    expect(contextItemCount([noComment], "normal")).toBe(1)
  })

  test("三条路径一视同仁 —— 有注释 / 占位注释 / 无注释,计数都算数", () => {
    const counts = [withComment, placeholderComment, noComment].map((item) =>
      contextItemCount([item], "normal"),
    )
    expect(new Set(counts)).toEqual(new Set([1]))
  })

  test("空列表为 0(什么都没有时不能变成「空消息也能发」)", () => {
    expect(contextItemCount([], "normal")).toBe(0)
  })

  test("shell 模式不数上下文项(原语义保留)", () => {
    expect(contextItemCount([noComment, withComment], "shell")).toBe(0)
  })

  test("多项累加", () => {
    expect(contextItemCount([withComment, noComment, placeholderComment], "normal")).toBe(3)
  })
})

describe("clearableContextItems · 发送后清理", () => {
  test("无注释的选区卡也要被清掉(本条即 bug-repro-2:发完残留 + 下一条重复发给模型)", () => {
    expect(clearableContextItems([noComment]).map((i) => i.key)).toEqual(["b"])
  })

  test("有注释 / 占位注释 / 无注释,三者一视同仁全清", () => {
    expect(clearableContextItems([withComment, noComment, placeholderComment]).map((i) => i.key)).toEqual([
      "a",
      "b",
      "c",
    ])
  })

  test("非 file 项不动(图片走另一套 attachments)", () => {
    expect(clearableContextItems([image, noComment]).map((i) => i.key)).toEqual(["b"])
  })

  test("空列表不炸", () => {
    expect(clearableContextItems([] as ContextGateItem[])).toEqual([])
  })

  test("返回的是原对象引用 —— 失败回吐要拿它们原样还回输入框", () => {
    const out = clearableContextItems([withComment])
    expect(out[0]).toBe(withComment)
  })
})
