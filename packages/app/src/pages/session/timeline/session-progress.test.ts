// FORK-ONLY: REQ-108 会话进度条纯逻辑回归锁 [feat: session-presentation-input-batch] 2026-08-17
import { describe, expect, test } from "bun:test"
import { nextSessionProgressStatus, sessionProgressPace, type SessionProgressStatus } from "./session-progress"

describe("sessionProgressPace", () => {
  test("窄窗夹到下限 1200ms(不快到发抖)", () => {
    expect(sessionProgressPace(0)).toBe(1200)
    expect(sessionProgressPace(360)).toBe(1200)
    expect(sessionProgressPace(-100)).toBe(1200)
  })

  test("宽窗夹到上限 3200ms(不慢到像卡住)", () => {
    expect(sessionProgressPace(5000)).toBe(3200)
    expect(sessionProgressPace(1440)).toBe(3200)
  })

  test("中段随宽度线性缩放", () => {
    expect(sessionProgressPace(640)).toBe(1422)
    expect(sessionProgressPace(900)).toBe(2000)
    expect(sessionProgressPace(1000)).toBe(2222)
  })

  test("单调不减", () => {
    let previous = 0
    for (let width = 0; width <= 2000; width += 50) {
      const value = sessionProgressPace(width)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })
})

describe("nextSessionProgressStatus · 三态与淡出", () => {
  test("任务开跑 → showing", () => {
    expect(nextSessionProgressStatus({ previous: undefined, working: true, timeoutDone: true })).toBe("showing")
    expect(nextSessionProgressStatus({ previous: "hidden", working: true, timeoutDone: true })).toBe("showing")
    expect(nextSessionProgressStatus({ previous: "hiding", working: true, timeoutDone: true })).toBe("showing")
  })

  test("任务结束先进 hiding —— 不许从 showing 直接跳 hidden(硬消失)", () => {
    expect(nextSessionProgressStatus({ previous: "showing", working: false, timeoutDone: true })).toBe("hiding")
  })

  test("淡出计时未走完时留在 hiding", () => {
    expect(nextSessionProgressStatus({ previous: "hiding", working: false, timeoutDone: false })).toBe("hiding")
  })

  test("淡出计时走完 → hidden", () => {
    expect(nextSessionProgressStatus({ previous: "hiding", working: false, timeoutDone: true })).toBe("hidden")
  })

  test("从没跑过任务时保持 hidden(冷启动不闪一下)", () => {
    expect(nextSessionProgressStatus({ previous: undefined, working: false, timeoutDone: true })).toBe("hidden")
    expect(nextSessionProgressStatus({ previous: "hidden", working: false, timeoutDone: true })).toBe("hidden")
  })

  test("完整生命周期:hidden → showing → hiding → hidden", () => {
    const trace: SessionProgressStatus[] = []
    let previous: SessionProgressStatus | undefined
    const step = (working: boolean, timeoutDone: boolean) => {
      previous = nextSessionProgressStatus({ previous, working, timeoutDone })
      trace.push(previous)
    }
    step(false, true) // 空闲
    step(true, true) // 开跑
    step(true, true) // 跑着
    step(false, false) // 刚结束,淡出计时开始
    step(false, false) // 淡出中
    step(false, true) // 淡出结束
    expect(trace).toEqual(["hidden", "showing", "showing", "hiding", "hiding", "hidden"])
  })
})
