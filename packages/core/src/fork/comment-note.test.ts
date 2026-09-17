// [bug-repro: 经「加入聊天窗口」发起的会话,标题清一色 User Made Following Comment Regarding File,
//              互相无法区分;中文提问也拿到英文标题]
// REQ-125 · 2026-09-17 · [feat: release-closeout-2026-09]
//
// 本文件同时守两件事:
//   ① 剥壳本身对不对(REQ-125 的修复)
//   ② **模板 ↔ 解析器的对偶契约**(往返测试)—— 这是"单一真源"的保命闸:
//      模板与两个正则必须一起改,谁改了一边忘了另一边,剥壳会静默失效、标题悄悄退回英文样板,
//      线上没有任何报错。这条红了,就是提醒你另一边也得改。

import { describe, expect, test } from "bun:test"
import {
  createCommentMetadata,
  formatCommentNote,
  parseCommentNote,
  readCommentMetadata,
  stripCommentNoteForTitle,
} from "./comment-note"

const selection = { startLine: 10, startChar: 0, endLine: 12, endChar: 0 }

describe("模板 ↔ 解析器 对偶契约(往返)", () => {
  const cases = [
    { name: "文件引用 · 无选区 · 无引文", input: { path: "src/a.ts", comment: "这里要改" } },
    { name: "文件引用 · 单行选区", input: { path: "src/a.ts", comment: "这里要改", selection: { ...selection, endLine: 10 } } },
    { name: "文件引用 · 多行选区", input: { path: "src/a.ts", comment: "这里要改", selection } },
    { name: "文件引用 · 带引文", input: { path: "src/a.ts", comment: "这里要改", selection, preview: "function parse() {}" } },
    { name: "文件引用 · 中文注释", input: { path: "src/解析器.ts", comment: "这段解析逻辑有 bug 吗?" } },
  ]

  for (const item of cases) {
    test(`${item.name} → parse(format(x)) 还原`, () => {
      const parsed = parseCommentNote(formatCommentNote(item.input))
      expect(parsed).toBeDefined()
      expect(parsed!.path).toBe(item.input.path)
      expect(parsed!.comment).toBe(item.input.comment)
      if (item.input.selection) {
        expect(parsed!.selection?.startLine).toBe(item.input.selection.startLine)
        expect(parsed!.selection?.endLine).toBe(item.input.selection.endLine)
      } else {
        expect(parsed!.selection).toBeUndefined()
      }
    })
  }

  test("metadata 往返:createCommentMetadata → readCommentMetadata 全字段还原", () => {
    const input = { path: "<chat selection>", comment: "按这个处理吧", preview: "引文原文", kind: "chat" as const }
    const back = readCommentMetadata(createCommentMetadata(input))
    expect(back?.path).toBe(input.path)
    expect(back?.comment).toBe(input.comment)
    expect(back?.preview).toBe(input.preview)
    expect(back?.kind).toBe(input.kind)
  })
})

describe("stripCommentNoteForTitle · 剥壳", () => {
  test("文件引用:只留用户真写的那句 + 文件名,英文样板不得残留", () => {
    const note = formatCommentNote({ path: "src/parser.ts", comment: "这段解析逻辑有 bug 吗?", selection })
    const stripped = stripCommentNoteForTitle(note)
    expect(stripped).toContain("这段解析逻辑有 bug 吗?")
    expect(stripped).toContain("parser.ts")
    expect(stripped).not.toContain("The user made the following comment")
    expect(stripped).not.toContain("regarding")
  })

  test("文件引用:带引文时引文不进标题(标题要短,引文是给主模型的)", () => {
    const note = formatCommentNote({ path: "a.ts", comment: "改这里", preview: "function veryLongSourceCode() {}" })
    expect(stripCommentNoteForTitle(note)).not.toContain("veryLongSourceCode")
  })

  test("文件引用:路径只留 basename,不把整条目录塞进标题", () => {
    const note = formatCommentNote({ path: "/Users/x/project/src/deep/parser.ts", comment: "改这里" })
    const stripped = stripCommentNoteForTitle(note)!
    expect(stripped).toContain("parser.ts")
    expect(stripped).not.toContain("/Users/x/project")
  })

  test("聊天引用:走另一条模板,同样要剥掉(一个正则接不住两个模板)", () => {
    const note = formatCommentNote({
      path: "<chat selection>",
      comment: "按这个处理吧",
      preview: "上一轮助手说的那段",
      kind: "chat",
    })
    const stripped = stripCommentNoteForTitle(note)
    expect(stripped).toBe("按这个处理吧")
    expect(stripped).not.toContain("The user is quoting")
    expect(stripped).not.toContain("<chat selection>")
  })

  test("聊天引用 · 无引文分支也要剥", () => {
    const note = formatCommentNote({ path: "<chat selection>", comment: "继续", kind: "chat" })
    expect(stripCommentNoteForTitle(note)).toBe("继续")
  })

  test("中文注释原样保留 —— 标题跟随用户语言的前提是模型看得见中文", () => {
    const note = formatCommentNote({ path: "a.ts", comment: "帮我把这段重构成异步的" })
    expect(stripCommentNoteForTitle(note)).toContain("帮我把这段重构成异步的")
  })

  test("不同注释剥出不同结果 —— 标题不再清一色相同(REQ-125 的核心诉求)", () => {
    const a = stripCommentNoteForTitle(formatCommentNote({ path: "a.ts", comment: "第一个问题" }))
    const b = stripCommentNoteForTitle(formatCommentNote({ path: "b.ts", comment: "第二个问题" }))
    expect(a).not.toBe(b)
  })

  test("普通消息不是模板 → undefined,调用方原样透传(不该误伤非引用消息)", () => {
    expect(stripCommentNoteForTitle("帮我写个排序函数")).toBeUndefined()
    expect(stripCommentNoteForTitle("")).toBeUndefined()
    expect(stripCommentNoteForTitle("The user made something up")).toBeUndefined()
  })
})
