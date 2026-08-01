// FORK-ONLY: REQ-085 浮层 Enter 穿透 bug-repro [feat: popup-enter-passthrough] 2026-08-02
import { describe, expect, test } from "bun:test"
import { keyEventFromEditableOutsideTree } from "./use-file-tree-shortcuts"

describe("keyEventFromEditableOutsideTree (REQ-085)", () => {
  test("bug-repro:浮层 textarea 提交时被同步卸载(detached),activeElement 已回落 body,但事件 target 仍应被识别为可编辑来源", () => {
    const textarea = document.createElement("textarea")
    // 模拟浮层:挂到 body(Portal),按 Enter 的元素级 handler 提交后同步 remove
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.remove()

    // 旧判定路径(document.activeElement)此刻已看不到 textarea → 会误放行 B 路径
    expect(document.activeElement === textarea).toBeFalse()
    // 新判定:事件原始 target 仍是 textarea → 不接管,Enter 不再穿透 toggle 预览区
    expect(keyEventFromEditableOutsideTree(textarea)).toBeTrue()
  })

  test("input / select / contentEditable 一律不接管", () => {
    expect(keyEventFromEditableOutsideTree(document.createElement("input"))).toBeTrue()
    expect(keyEventFromEditableOutsideTree(document.createElement("select"))).toBeTrue()
    const div = document.createElement("div")
    div.contentEditable = "true"
    expect(keyEventFromEditableOutsideTree(div)).toBeTrue()
  })

  test("文件树内部的可编辑控件不受新守卫影响(保 A 路径行为)", () => {
    const tree = document.createElement("div")
    tree.setAttribute("data-component", "filetree")
    const rename = document.createElement("input")
    tree.appendChild(rename)
    document.body.appendChild(tree)
    expect(keyEventFromEditableOutsideTree(rename)).toBeFalse()
    tree.remove()
  })

  test("普通元素 / 空 target 不拦截", () => {
    expect(keyEventFromEditableOutsideTree(document.createElement("div"))).toBeFalse()
    expect(keyEventFromEditableOutsideTree(null)).toBeFalse()
  })
})
