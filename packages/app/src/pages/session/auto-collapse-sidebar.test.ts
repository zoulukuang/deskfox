// [fork-only] 窄窗口自动收起右侧侧栏 —— 判定逻辑单测 [feat: narrow-window-auto-collapse] 2026-08-12
//
// [bug-repro: 1280 宽窗口下五栏容器溢出 40px;再打开文件预览时预览区被挤到约 80px、
//   文字竖排成一列完全不可读。user 2026-08-12 真机反馈截图]
import { describe, test, expect } from "bun:test"
import { decideSidebarAutoCollapse } from "./auto-collapse-sidebar"

const base = { overflowPx: 0, sidebarOpen: true, sidebarWidth: 445, autoCollapsed: false }

describe("decideSidebarAutoCollapse", () => {
  test("溢出 + 侧栏开着 → 自动收起", () => {
    expect(decideSidebarAutoCollapse({ ...base, overflowPx: 40 })).toBe("collapse")
  })

  test("不溢出 → 不动", () => {
    expect(decideSidebarAutoCollapse({ ...base, overflowPx: 0 })).toBe("keep")
    expect(decideSidebarAutoCollapse({ ...base, overflowPx: -200 })).toBe("keep")
  })

  test("迟滞:收起后富余不足以放回侧栏 → 保持收起(防抖动)", () => {
    // 收起后富余 400,但侧栏要 445 + 余量 48 → 放不回去
    expect(
      decideSidebarAutoCollapse({ ...base, sidebarOpen: false, autoCollapsed: true, overflowPx: -400 }),
    ).toBe("keep")
  })

  test("窗口拉宽到放得回去(富余 ≥ 侧栏宽 + 余量)→ 恢复", () => {
    expect(
      decideSidebarAutoCollapse({ ...base, sidebarOpen: false, autoCollapsed: true, overflowPx: -(445 + 48) }),
    ).toBe("restore")
    expect(
      decideSidebarAutoCollapse({ ...base, sidebarOpen: false, autoCollapsed: true, overflowPx: -900 }),
    ).toBe("restore")
  })

  test("用户自己收起的侧栏,绝不擅自替他打开", () => {
    expect(
      decideSidebarAutoCollapse({ ...base, sidebarOpen: false, autoCollapsed: false, overflowPx: -9999 }),
    ).toBe("keep")
  })

  test("用户在窄窗口下手动把侧栏开回来 → 不再跟他抢(靠调用方清 autoCollapsed 标志)", () => {
    // autoCollapsed 仍为 true 且用户手动开回 → 本函数不再重复收起
    expect(
      decideSidebarAutoCollapse({ ...base, sidebarOpen: true, autoCollapsed: true, overflowPx: 40 }),
    ).toBe("keep")
  })

  test("迟滞余量可调", () => {
    expect(
      decideSidebarAutoCollapse({
        ...base, sidebarOpen: false, autoCollapsed: true, overflowPx: -450, restoreMarginPx: 0,
      }),
    ).toBe("restore")
    expect(
      decideSidebarAutoCollapse({
        ...base, sidebarOpen: false, autoCollapsed: true, overflowPx: -450, restoreMarginPx: 100,
      }),
    ).toBe("keep")
  })

  test("真实场景回放:1280 宽溢出 40 → 收起;拉到 1475(富余约 525)→ 恢复", () => {
    let autoCollapsed = false
    let sidebarOpen = true

    const a1 = decideSidebarAutoCollapse({ overflowPx: 40, sidebarOpen, sidebarWidth: 445, autoCollapsed })
    expect(a1).toBe("collapse")
    autoCollapsed = true
    sidebarOpen = false

    // 收起后富余 405(445-40),还放不回去
    expect(
      decideSidebarAutoCollapse({ overflowPx: -405, sidebarOpen, sidebarWidth: 445, autoCollapsed }),
    ).toBe("keep")

    // 窗口拉宽 195px 后富余 600 ≥ 445+48 → 恢复
    expect(
      decideSidebarAutoCollapse({ overflowPx: -600, sidebarOpen, sidebarWidth: 445, autoCollapsed }),
    ).toBe("restore")
  })
})
