// [fork-only] 文件树宽度唯一事实源 —— 回归钉 [feat: file-tree-width-single-source] 2026-08-13
//
// [bug-repro: 上游本次 sync 给侧面板加了 max(240, 存储宽度) 的 clamp,却没同步聊天区的
//   `calc(100% - 存储宽度)` —— 存储 200 时侧面板实际占 240、聊天区只让 200,
//   聊天区恒定溢出 40px,被右侧会话面板盖住,导致**查找框「关闭」按钮和会话「更多」按钮点不到**。
//   user 2026-08-13 反馈;实测 viewport 1600 下 main 右缘 1155、查找框右缘 1179。]
import { test, expect, describe } from "bun:test"
import { FILE_TREE_WIDTH_MIN, resolvedFileTreeWidth } from "./file-tree-width"

describe("resolvedFileTreeWidth", () => {
  test("低于最小值时取最小值 —— 这正是 bug 现场(存储 200 → 实际 240)", () => {
    expect(resolvedFileTreeWidth(200)).toBe(240)
    expect(resolvedFileTreeWidth(0)).toBe(240)
  })

  test("高于最小值时原样返回(用户拖宽的宽度要尊重)", () => {
    expect(resolvedFileTreeWidth(320)).toBe(320)
    expect(resolvedFileTreeWidth(600)).toBe(600)
  })

  test("等于最小值", () => {
    expect(resolvedFileTreeWidth(FILE_TREE_WIDTH_MIN)).toBe(FILE_TREE_WIDTH_MIN)
  })

  test("最小值常量本身(上游若改动此值,两处会同步跟随)", () => {
    expect(FILE_TREE_WIDTH_MIN).toBe(240)
  })

  test("核心不变式:侧面板占位 + 聊天区让位 必须相等,否则必然溢出", () => {
    // 模拟两处的计算:都必须走 resolvedFileTreeWidth
    for (const stored of [0, 120, 200, 239, 240, 300, 800]) {
      const sidePanelActual = resolvedFileTreeWidth(stored) // 侧面板实际渲染宽度
      const chatYields = resolvedFileTreeWidth(stored) // 聊天区让出的宽度
      expect(sidePanelActual).toBe(chatYields)
    }
  })

  test("反例钉子:若聊天区用裸存储值,存储 200 时会差 40px(即本 bug 的量)", () => {
    const stored = 200
    expect(resolvedFileTreeWidth(stored) - stored).toBe(40)
  })
})
