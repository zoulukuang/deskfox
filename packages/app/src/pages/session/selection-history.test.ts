// FORK: ViewerSelectionHistory + readSelectionWithShadows 单测
// 抽出自 file-tabs.tsx 原 ~125 行 macOS Shadow DOM 选区修复段(2026-05-29 refactor)。
// 关键不变量:pickBestRecent "30s 内最长" 语义对抗 macOS WebKit shadow collapse bug。

import { describe, expect, test, beforeEach } from "bun:test"
import {
  ViewerSelectionHistory,
  SEL_HISTORY_LIMIT,
  readSelectionWithShadows,
  type SelSnapshot,
} from "./selection-history"

// happy-dom 不提供 window.getSelection() 完整实现,我们直接 mock Selection-like 对象。
type MockSelection = {
  toString(): string
  rangeCount: number
  getRangeAt(i: number): Range
}

function makeRange(): Range {
  // happy-dom 支持 document.createRange
  return document.createRange()
}

function makeMockSelection(text: string, hasRange = true): MockSelection {
  const r = makeRange()
  return {
    toString: () => text,
    rangeCount: hasRange ? 1 : 0,
    getRangeAt: () => r,
  }
}

describe("ViewerSelectionHistory · pushFromSelection + pickBestRecent", () => {
  let history: ViewerSelectionHistory

  beforeEach(() => {
    history = new ViewerSelectionHistory()
  })

  test("空 history → pickBestRecent 返回 null", () => {
    expect(history.pickBestRecent()).toBeNull()
  })

  test("push 一条 → pickBest 返回它", () => {
    history.pushFromSelection(makeMockSelection("hello") as unknown as Selection)
    expect(history.size()).toBe(1)
    const best = history.pickBestRecent()
    expect(best?.text).toBe("hello")
  })

  test("空文本不入栈", () => {
    history.pushFromSelection(makeMockSelection("") as unknown as Selection)
    history.pushFromSelection(makeMockSelection("   \n  ") as unknown as Selection)
    expect(history.size()).toBe(0)
  })

  test("挑最长(对抗 collapse bug 的核心不变量)", () => {
    history.pushFromSelection(makeMockSelection("短") as unknown as Selection)
    history.pushFromSelection(makeMockSelection("长文本多几个字符") as unknown as Selection)
    history.pushFromSelection(makeMockSelection("中长") as unknown as Selection)
    expect(history.pickBestRecent()?.text).toBe("长文本多几个字符")
  })

  test("超过 SEL_HISTORY_LIMIT 自动 shift 旧条目", () => {
    for (let i = 0; i < SEL_HISTORY_LIMIT + 5; i++) {
      history.pushFromSelection(makeMockSelection(`item-${i}`) as unknown as Selection)
    }
    expect(history.size()).toBe(SEL_HISTORY_LIMIT)
  })

  test("超出 30s 窗口的条目不参与 pickBest", () => {
    history.pushFromSelection(makeMockSelection("ancient long long long long") as unknown as Selection)
    history.pushFromSelection(makeMockSelection("new short") as unknown as Selection)
    // 用 +31s 的虚拟 now,把第二条之前的都排除
    // 这里两条都是新加的(time ≈ 现在),传 now = Date.now() + 31000:第一条肯定超 30s
    // 但 pickBest 迭代里 `if (now - s.time > 30000) break` 是逆序,第一条会被 break 跳出 — 故第二条仍能命中
    // 模拟:把所有条目 time 推远到 60s 前后(直接 mock）— 这里改用 clear + 手工注入
    history.clear()
    // 用 pickBest 接受外部 now 参数测时间窗
    const r1 = makeRange()
    const r2 = makeRange()
    ;(history as any).entries.push({ text: "ancient long", range: r1, shadow: null, time: 1_000_000_000 } as SelSnapshot)
    ;(history as any).entries.push({ text: "new short", range: r2, shadow: null, time: 1_000_060_000 } as SelSnapshot)
    // now = 1_000_061_000(距 ancient 61s,距 new 1s)→ ancient 超窗,new 不超
    const best = history.pickBestRecent(1_000_061_000)
    expect(best?.text).toBe("new short")
  })

  test("clear() 重置", () => {
    history.pushFromSelection(makeMockSelection("x") as unknown as Selection)
    history.clear()
    expect(history.size()).toBe(0)
    expect(history.pickBestRecent()).toBeNull()
  })
})

describe("ViewerSelectionHistory · collectShadow*", () => {
  let history: ViewerSelectionHistory

  beforeEach(() => {
    history = new ViewerSelectionHistory()
  })

  test("collectShadow(root) → root 进入 knownShadows", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: "open" })
    history.collectShadow(shadow)
    // 用 readSelection 走策略 2 间接验证(它会迭代 knownShadows)
    // 直接验:在 host 里塞文字,模拟 selection 走 fallback
    expect((history as any).knownShadows.has(shadow)).toBe(true)
    host.remove()
  })

  test("collectShadowFromEvent — composedPath 含 ShadowRoot → 收入", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: "open" })
    const fakeEvent = {
      composedPath: () => [shadow, host, document.body],
      currentTarget: null,
    } as unknown as MouseEvent
    const found = history.collectShadowFromEvent(fakeEvent)
    expect(found).toBe(shadow)
    expect((history as any).knownShadows.has(shadow)).toBe(true)
    host.remove()
  })

  test("collectShadowFromEvent — currentTarget 含 diffs-container 备路径", () => {
    const root = document.createElement("div")
    const diffsContainer = document.createElement("diffs-container") // custom element
    const shadow = diffsContainer.attachShadow({ mode: "open" })
    root.appendChild(diffsContainer)
    document.body.appendChild(root)
    const fakeEvent = {
      composedPath: () => [],
      currentTarget: root,
    } as unknown as MouseEvent
    history.collectShadowFromEvent(fakeEvent)
    expect((history as any).knownShadows.has(shadow)).toBe(true)
    root.remove()
  })
})

describe("readSelectionWithShadows (策略 3 默认 light DOM)", () => {
  test("非空 light DOM selection → 返回 text + range + shadow=null", () => {
    const p = document.createElement("p")
    p.textContent = "light DOM 文本"
    document.body.appendChild(p)
    const sel = makeMockSelection("light DOM 文本") as unknown as Selection
    const result = readSelectionWithShadows(sel, new Set())
    expect(result.text).toBe("light DOM 文本")
    expect(result.range).not.toBeNull()
    expect(result.shadow).toBeNull()
    p.remove()
  })

  test("空 selection + 0 known shadow → 全空结果", () => {
    const sel = makeMockSelection("") as unknown as Selection
    const result = readSelectionWithShadows(sel, new Set())
    expect(result.text).toBe("")
    expect(result.range).toBeNull()
    expect(result.shadow).toBeNull()
  })
})
