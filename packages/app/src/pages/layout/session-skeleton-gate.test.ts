// [feat: startup-sidebar-feedback] REQ-092 T1-T4
import { describe, expect, test } from "bun:test"
import { showSessionSkeleton } from "./session-skeleton-gate"

describe("showSessionSkeleton", () => {
  test("T1: 启动期(not ready)无会话 → 亮", () => {
    expect(showSessionSkeleton(0, 0, false)).toBe(true)
  })

  test("T2: ready 且无查询无会话 → 不亮(空态交给 NewSessionItem)", () => {
    expect(showSessionSkeleton(0, 0, true)).toBe(false)
  })

  test("T3: 拉取中无会话 → 亮(原行为不变)", () => {
    expect(showSessionSkeleton(1, 0, true)).toBe(true)
    expect(showSessionSkeleton(2, 0, false)).toBe(true)
  })

  test("T4: 已有会话 → 永不亮(防遮内容)", () => {
    expect(showSessionSkeleton(1, 3, true)).toBe(false)
    expect(showSessionSkeleton(0, 1, false)).toBe(false)
  })
})
