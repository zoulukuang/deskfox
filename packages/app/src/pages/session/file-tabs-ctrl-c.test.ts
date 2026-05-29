// FORK: Ctrl+C v2 单测 — 三场景 bug-repro 锁定。
// 起源:OPENCODE-PLAN/需求池/ctrl-c-复制失效.md v2(R5 测试纪律 — bug fix 必须先写复现测试)。
// 这些 case 在旧 pickBestRecentSelection() history 路径下会 fail,新 decideCtrlCAction 决策下 pass。

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { decideCtrlCAction, isAnchorInsideViewer } from "./file-tabs-ctrl-c"

describe("isAnchorInsideViewer", () => {
  let viewer: HTMLElement
  let outside: HTMLElement

  beforeEach(() => {
    viewer = document.createElement("div")
    viewer.setAttribute("data-component", "file-viewer")
    document.body.appendChild(viewer)

    outside = document.createElement("div")
    document.body.appendChild(outside)
  })

  afterEach(() => {
    viewer.remove()
    outside.remove()
  })

  test("anchor is text node inside viewer → true", () => {
    const p = document.createElement("p")
    p.textContent = "hello"
    viewer.appendChild(p)
    const textNode = p.firstChild!
    expect(isAnchorInsideViewer(textNode, viewer)).toBe(true)
  })

  test("anchor is element inside viewer → true", () => {
    const p = document.createElement("p")
    viewer.appendChild(p)
    expect(isAnchorInsideViewer(p, viewer)).toBe(true)
  })

  test("anchor in unrelated sibling (chat area) → false", () => {
    const chat = document.createElement("p")
    chat.textContent = "聊天里的文字"
    outside.appendChild(chat)
    expect(isAnchorInsideViewer(chat.firstChild, viewer)).toBe(false)
  })

  test("anchor === viewer itself (whole-viewer select) → true", () => {
    expect(isAnchorInsideViewer(viewer, viewer)).toBe(true)
  })

  test("null anchor → false (no-op)", () => {
    expect(isAnchorInsideViewer(null, viewer)).toBe(false)
  })

  test("null viewerRoot → false (defensive)", () => {
    const p = document.createElement("p")
    viewer.appendChild(p)
    expect(isAnchorInsideViewer(p, null)).toBe(false)
    expect(isAnchorInsideViewer(p, undefined)).toBe(false)
  })

  test("anchor inside Shadow DOM → climb to host → true if host in viewer", () => {
    const host = document.createElement("div")
    viewer.appendChild(host)
    const shadow = host.attachShadow({ mode: "open" })
    const innerP = document.createElement("p")
    innerP.textContent = "shadow 内 code"
    shadow.appendChild(innerP)
    const textNode = innerP.firstChild!

    // getRootNode() should return the ShadowRoot; helper climbs to host;
    // host is inside viewer → true
    expect(isAnchorInsideViewer(textNode, viewer)).toBe(true)
  })

  test("anchor inside Shadow DOM whose host is outside viewer → false", () => {
    const host = document.createElement("div")
    outside.appendChild(host)
    const shadow = host.attachShadow({ mode: "open" })
    const innerP = document.createElement("p")
    innerP.textContent = "另一区域的 shadow"
    shadow.appendChild(innerP)
    expect(isAnchorInsideViewer(innerP.firstChild, viewer)).toBe(false)
  })
})

describe("decideCtrlCAction", () => {
  let viewer: HTMLElement
  let chatArea: HTMLElement

  beforeEach(() => {
    viewer = document.createElement("div")
    viewer.setAttribute("data-component", "file-viewer")
    document.body.appendChild(viewer)

    chatArea = document.createElement("div")
    document.body.appendChild(chatArea)
  })

  afterEach(() => {
    viewer.remove()
    chatArea.remove()
  })

  // ============ 场景 C:取消选区后幽灵复制 ============
  test("场景 C:无选区(text 空)→ noop,不写剪贴板", () => {
    expect(
      decideCtrlCAction({ text: "", shadow: null, anchorNode: null, viewerRoot: viewer }),
    ).toEqual({ action: "noop" })
  })

  test("场景 C 变体:text 全空白 → noop", () => {
    expect(
      decideCtrlCAction({ text: "   \n  ", shadow: null, anchorNode: null, viewerRoot: viewer }),
    ).toEqual({ action: "noop" })
  })

  // ============ 场景 B:跨区域污染 ============
  test("场景 B:viewer active 但用户在 chat 区选了文字 → noop,让原生 Ctrl+C 处理 chat 选区", () => {
    const chatP = document.createElement("p")
    chatP.textContent = "聊天区的短文本"
    chatArea.appendChild(chatP)

    expect(
      decideCtrlCAction({
        text: "聊天区的短文本",
        shadow: null,
        anchorNode: chatP.firstChild,
        viewerRoot: viewer,
      }),
    ).toEqual({ action: "noop" })
  })

  // ============ 场景 A:viewer 内重选短覆盖长 ============
  test("场景 A light DOM:viewer 内选了短文本 → native(让原生 Ctrl+C 直接复制)", () => {
    const p = document.createElement("p")
    p.textContent = "短文本"
    viewer.appendChild(p)

    expect(
      decideCtrlCAction({
        text: "短文本",
        shadow: null,
        anchorNode: p.firstChild,
        viewerRoot: viewer,
      }),
    ).toEqual({ action: "native" })
  })

  test("场景 A shadow DOM:viewer 内 shadow 选了短文本 → shadow-intercept,用当前(非 history)", () => {
    const host = document.createElement("div")
    viewer.appendChild(host)
    const shadow = host.attachShadow({ mode: "open" })
    const innerP = document.createElement("p")
    innerP.textContent = "shadow 短文本"
    shadow.appendChild(innerP)

    expect(
      decideCtrlCAction({
        text: "shadow 短文本",
        shadow,
        anchorNode: innerP.firstChild,
        viewerRoot: viewer,
      }),
    ).toEqual({ action: "shadow-intercept", text: "shadow 短文本" })
  })

  // ============ 关键回归:Pierre Shadow DOM 选区不丢失 ============
  test("回归:shadow DOM 内长文本仍被 intercept(原生不能拿,必须 handler 写)", () => {
    const host = document.createElement("div")
    viewer.appendChild(host)
    const shadow = host.attachShadow({ mode: "open" })
    const innerP = document.createElement("p")
    const longText = "function foo() {\n  return bar()\n}\n// 多行代码选区"
    innerP.textContent = longText
    shadow.appendChild(innerP)

    expect(
      decideCtrlCAction({
        text: longText,
        shadow,
        anchorNode: innerP.firstChild,
        viewerRoot: viewer,
      }),
    ).toEqual({ action: "shadow-intercept", text: longText })
  })

  // ============ light DOM 反例(md 文件):让原生走 ============
  test("回归:md(light DOM)长文本 → native,不 preventDefault(原生 Ctrl+C 就能正确处理)", () => {
    const p = document.createElement("p")
    p.textContent = "Markdown 内一段较长的文本被用户选中了"
    viewer.appendChild(p)

    expect(
      decideCtrlCAction({
        text: "Markdown 内一段较长的文本被用户选中了",
        shadow: null,
        anchorNode: p.firstChild,
        viewerRoot: viewer,
      }),
    ).toEqual({ action: "native" })
  })

  // ============ 防御性:viewerRoot 缺失时不 crash ============
  test("viewerRoot 还没 mount → noop(防御性,不 crash)", () => {
    const p = document.createElement("p")
    p.textContent = "x"
    chatArea.appendChild(p)
    expect(
      decideCtrlCAction({
        text: "x",
        shadow: null,
        anchorNode: p.firstChild,
        viewerRoot: undefined,
      }),
    ).toEqual({ action: "noop" })
  })
})
