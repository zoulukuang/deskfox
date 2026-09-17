// FORK-ONLY: REQ-111 点当前 tab 收起预览器 —— 判定回归锁
// [feat: session-presentation-input-batch] 2026-08-17
import { describe, expect, test } from "bun:test"
import { decideTabCollapse, TAB_COLLAPSE_DEFER_MS } from "./session-tab-collapse"

const base = {
  tab: "file://src/a.ts",
  activeAtPress: "file://src/a.ts",
  viewerOpen: true,
  isTemporary: false,
  isFileTab: true,
}

describe("decideTabCollapse", () => {
  test("点已激活的永久文件 tab + 预览器开着 → 立即收起", () => {
    expect(decideTabCollapse(base)).toBe("collapse")
  })

  test("🔒 点的不是「按下时那个激活 tab」→ 不收(切 tab 不该把面板收掉)", () => {
    // 坑 ①:点非激活 tab 时 Kobalte 会先把它切成激活,若在 click 里读实时 activeTab 就会误判
    expect(decideTabCollapse({ ...base, activeAtPress: "file://src/other.ts" })).toBe("ignore")
    expect(decideTabCollapse({ ...base, activeAtPress: undefined })).toBe("ignore")
  })

  test("预览器本来就没开 → 不做事(没有可收的东西)", () => {
    expect(decideTabCollapse({ ...base, viewerOpen: false })).toBe("ignore")
  })

  test("非文件 tab(review / context 等)不参与", () => {
    expect(decideTabCollapse({ ...base, isFileTab: false })).toBe("ignore")
  })

  test("🔒 临时(preview)tab → defer,不立即收 —— 给 v2 双击开永久 tab 让路", () => {
    // 坑 ②:v2 里文件树单击 = preview、双击该 tab = 提升为永久。双击的第一下会先到 click,
    // 立即收起就会把双击语义打断(2026-08-11 正是因为这个冲突,整条 toggle 被 !newLayoutDesigns() 关掉)
    expect(decideTabCollapse({ ...base, isTemporary: true })).toBe("defer")
  })

  test("临时 tab 的其他否决条件优先于 defer", () => {
    expect(decideTabCollapse({ ...base, isTemporary: true, viewerOpen: false })).toBe("ignore")
    expect(decideTabCollapse({ ...base, isTemporary: true, isFileTab: false })).toBe("ignore")
    expect(decideTabCollapse({ ...base, isTemporary: true, activeAtPress: "file://x.ts" })).toBe("ignore")
  })

  test("延后窗口够长到能等到系统双击的第二下,又短到不像卡顿", () => {
    expect(TAB_COLLAPSE_DEFER_MS).toBeGreaterThanOrEqual(250)
    expect(TAB_COLLAPSE_DEFER_MS).toBeLessThanOrEqual(400)
  })
})

// [bug-repro: 点文件预览区顶部标签的 ×,被关的若是当前激活那个,整个预览区被收起;
//             期望只关这一个、预览区保持展开并切到递补的相邻标签]
// REQ-130 · 2026-09-17 · [feat: release-closeout-2026-09]
//
// 主修法在 session-sortable-tab{,-v2}.tsx:wrapper 的 onClick 认出 × 就 return
// (× 在 DOM 上是 wrapper 的后代,点它必然冒泡)。那一层是 DOM 行为,只能 e2e 验。
// 这里测的是纯逻辑兜底:× 的 onClick 先把 tab 关掉,click 才冒上来 ——
// 冒上来时那个 tab 已经不存在了,「点一个不存在的 tab」不该触发任何收起判定。
describe("decideTabCollapse · REQ-130 tab 已不存在的兜底", () => {
  test("tab 在 click 冒泡上来时已被关掉 → ignore(本条即 REQ-130 的复现)", () => {
    expect(decideTabCollapse({ ...base, tabStillExists: false })).toBe("ignore")
  })

  test("tabStillExists 优先级最高 —— 其余条件全真也不收", () => {
    expect(
      decideTabCollapse({
        tab: "file://src/a.ts",
        activeAtPress: "file://src/a.ts",
        viewerOpen: true,
        isTemporary: false,
        isFileTab: true,
        tabStillExists: false,
      }),
    ).toBe("ignore")
  })

  test("临时 tab 被关掉后也不 defer —— 别留一个指向已消失 tab 的延时收起", () => {
    expect(decideTabCollapse({ ...base, isTemporary: true, tabStillExists: false })).toBe("ignore")
  })

  test("tab 还在 → 照旧收起", () => {
    expect(decideTabCollapse({ ...base, tabStillExists: true })).toBe("collapse")
  })

  test("省略该字段 → 行为与 REQ-111 原样一致(老调用方不受影响)", () => {
    expect(decideTabCollapse(base)).toBe("collapse")
  })
})
