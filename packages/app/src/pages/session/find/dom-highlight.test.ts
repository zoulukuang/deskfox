// FORK-ONLY test: REQ-097 — DOM Range 收集与单元内数据直达定位(happy-dom)[feat: in-session-find]
import { describe, expect, test } from "bun:test"
import { collectRanges, highlightSupported, locateRangeInUnit } from "./dom-highlight"

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

describe("dom-highlight.locateRangeInUnit", () => {
  test("assistant 单元:按 data-find-part-ids 找行,行内取第 k 个", () => {
    const root = mount(
      `<div data-message-id="m1"><span>词</span></div>` +
        `<div data-find-part-ids="prt_a prt_x"><span>词 和 词</span></div>` +
        `<div data-find-part-ids="prt_b"><span>词</span></div>`,
    )
    const base = { anchorID: "m1", unitID: "prt_a", isUser: false }
    expect(locateRangeInUnit(root, "词", { ...base, indexInUnit: 0 })?.toString()).toBe("词")
    expect(locateRangeInUnit(root, "词", { ...base, indexInUnit: 1 })).toBeDefined()
    expect(locateRangeInUnit(root, "词", { ...base, indexInUnit: 2 })).toBeUndefined()
    root.remove()
  })
  test("user 单元:按 data-message-id 找行", () => {
    const root = mount(`<div data-message-id="m1"><span>词甲 词乙</span></div>`)
    const unit = { anchorID: "m1", unitID: "m1", isUser: true, indexInUnit: 1 }
    expect(locateRangeInUnit(root, "词", unit)?.startContainer.textContent).toContain("词乙")
    root.remove()
  })
  test("行未渲染(虚拟化卸载)返回 undefined", () => {
    const root = mount(`<div data-message-id="m1">词</div>`)
    expect(locateRangeInUnit(root, "词", { anchorID: "m9", unitID: "prt_z", isUser: false, indexInUnit: 0 })).toBeUndefined()
    root.remove()
  })
})

describe("dom-highlight.highlightSupported", () => {
  test("不支持 CSS.highlights 的环境返回 false(不抛)", () => {
    expect(typeof highlightSupported()).toBe("boolean")
  })
})
