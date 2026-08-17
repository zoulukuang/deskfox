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
