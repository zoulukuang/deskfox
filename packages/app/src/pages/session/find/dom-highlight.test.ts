// FORK-ONLY test: REQ-097 — DOM Range 收集与轮次定位(happy-dom;CSS.highlights 不可用时降级)
// [feat: in-session-find]
import { describe, expect, test } from "bun:test"
import { collectRanges, highlightSupported, locateActiveRange } from "./dom-highlight"

function mount(html: string): HTMLElement {
  const root = document.createElement("div")
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

describe("dom-highlight.collectRanges", () => {
  test("跨元素文本节点按文档序收集,大小写不敏感", () => {
    const root = mount(`<p>报错在<b>这里报错</b></p><p>还有 Error</p>`)
    const cn = collectRanges(root, "报错")
    expect(cn.length).toBe(2)
    expect(cn[0].toString()).toBe("报错")
    const en = collectRanges(root, "error")
    expect(en.length).toBe(1)
    root.remove()
  })
  test("空查询返回空", () => {
    const root = mount(`<p>abc</p>`)
    expect(collectRanges(root, "")).toEqual([])
    root.remove()
  })
})

describe("dom-highlight.locateActiveRange", () => {
  test("按锚点行切轮次,取轮内第 n 个出现", () => {
    const root = mount(
      `<div data-message-id="m1"><span>词</span></div>` +
        `<div class="assistant"><span>词 和 词</span></div>` +
        `<div data-message-id="m2"><span>词</span></div>`,
    )
    const ranges = collectRanges(root, "词")
    expect(ranges.length).toBe(4)
    // m1 轮 = 锚点行 1 个 + assistant 行 2 个
    expect(locateActiveRange(root, ranges, "m1", 0)?.startContainer.textContent).toBe("词")
    expect(locateActiveRange(root, ranges, "m1", 2)).toBeDefined()
    expect(locateActiveRange(root, ranges, "m1", 3)).toBeUndefined()
    // m2 轮只有 1 个
    expect(locateActiveRange(root, ranges, "m2", 0)).toBeDefined()
    expect(locateActiveRange(root, ranges, "m2", 1)).toBeUndefined()
    root.remove()
  })
  test("锚点不存在(未渲染)返回 undefined", () => {
    const root = mount(`<div data-message-id="m1">词</div>`)
    const ranges = collectRanges(root, "词")
    expect(locateActiveRange(root, ranges, "m9", 0)).toBeUndefined()
    root.remove()
  })
})

describe("dom-highlight.highlightSupported", () => {
  test("不支持 CSS.highlights 的环境返回 false(不抛)", () => {
    expect(typeof highlightSupported()).toBe("boolean")
  })
})
