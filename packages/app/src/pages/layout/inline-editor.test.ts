// FORK-ONLY test: REQ-096 — inline 编辑提交语义(blur 保存/Esc 放弃/空值与未改动恢复)
// [feat: session-list-ux]
import { describe, expect, test } from "bun:test"
import { createInlineEditorController } from "./inline-editor"

describe("createInlineEditorController.commitEditor", () => {
  test("有改动时提交并关闭", () => {
    const c = createInlineEditorController()
    c.openEditor("s1", "旧标题")
    c.setEditor("value", "新标题")
    let saved: string | undefined
    c.commitEditor("旧标题", (next) => (saved = next))
    expect(saved).toBe("新标题")
    expect(c.editorOpen("s1")).toBe(false)
  })

  test("未改动时只关闭不提交", () => {
    const c = createInlineEditorController()
    c.openEditor("s1", "标题")
    let called = 0
    c.commitEditor("标题", () => called++)
    expect(called).toBe(0)
    expect(c.editorOpen("s1")).toBe(false)
  })

  test("清空(或全空白)时恢复原值不提交", () => {
    const c = createInlineEditorController()
    c.openEditor("s1", "标题")
    c.setEditor("value", "   ")
    let called = 0
    c.commitEditor("标题", () => called++)
    expect(called).toBe(0)
    expect(c.editorOpen("s1")).toBe(false)
  })

  test("首尾空白被 trim 后提交", () => {
    const c = createInlineEditorController()
    c.openEditor("s1", "旧")
    c.setEditor("value", "  新  ")
    let saved: string | undefined
    c.commitEditor("旧", (next) => (saved = next))
    expect(saved).toBe("新")
  })
})

describe("createInlineEditorController.editorKeyDown", () => {
  const key = (name: string) => new KeyboardEvent("keydown", { key: name, cancelable: true })

  test("Enter 带 current 时走 commit(未改动不提交)", () => {
    const c = createInlineEditorController()
    c.openEditor("s1", "标题")
    let called = 0
    c.editorKeyDown(key("Enter"), () => called++, "标题")
    expect(called).toBe(0)
    expect(c.editorOpen("s1")).toBe(false)
  })

  test("Enter 有改动时提交", () => {
    const c = createInlineEditorController()
    c.openEditor("s1", "旧")
    c.setEditor("value", "新")
    let saved: string | undefined
    c.editorKeyDown(key("Enter"), (next) => (saved = next), "旧")
    expect(saved).toBe("新")
  })

  test("Escape 放弃且不提交", () => {
    const c = createInlineEditorController()
    c.openEditor("s1", "旧")
    c.setEditor("value", "改了")
    let called = 0
    c.editorKeyDown(key("Escape"), () => called++, "旧")
    expect(called).toBe(0)
    expect(c.editorOpen("s1")).toBe(false)
  })

  test("旧签名(无 current)Enter 仍走 saveEditor(非空即提交)", () => {
    const c = createInlineEditorController()
    c.openEditor("s1", "同值")
    let called = 0
    c.editorKeyDown(key("Enter"), () => called++)
    expect(called).toBe(1)
  })
})
