import { describe, expect, test } from "bun:test"
import { shouldShowUserMessageActions } from "./user-message-actions"

// FORK: REQ-123 — 纯引用消息(只有 chat selection 卡片、无正文)撤回按钮不出现 2026-08-19
describe("shouldShowUserMessageActions", () => {
  const base = { hasText: false, canRevert: false, hasInlineComments: false, useV2Actions: false }

  // T1
  test("有正文 → 显示(上游原判据不回归)", () => {
    expect(shouldShowUserMessageActions({ ...base, hasText: true })).toBe(true)
    expect(shouldShowUserMessageActions({ ...base, hasText: true, useV2Actions: true })).toBe(true)
  })

  // T2
  test("无正文 + 无动作 + 无卡片 → 不显示(不给空消息凭空造动作条)", () => {
    expect(shouldShowUserMessageActions(base)).toBe(false)
    expect(shouldShowUserMessageActions({ ...base, useV2Actions: true })).toBe(false)
  })

  // T3 —— bug-repro 主线
  test("无正文 + 有撤回动作 → 显示(经典布局纯引用消息)", () => {
    expect(shouldShowUserMessageActions({ ...base, canRevert: true })).toBe(true)
  })

  // T4
  test("无正文 + 无动作 + V2 内联卡片 → 显示(上游既有分支)", () => {
    expect(shouldShowUserMessageActions({ ...base, hasInlineComments: true, useV2Actions: true })).toBe(true)
  })

  // T5
  test("经典布局下内联卡片不单独成立(卡片走独立的 CommentStrip 行)", () => {
    expect(shouldShowUserMessageActions({ ...base, hasInlineComments: true, useV2Actions: false })).toBe(false)
  })

  // T6
  test("两种 useV2Actions 取值下,有撤回动作都显示(防只修一边)", () => {
    for (const useV2Actions of [false, true]) {
      expect(shouldShowUserMessageActions({ ...base, canRevert: true, useV2Actions })).toBe(true)
      expect(shouldShowUserMessageActions({ ...base, canRevert: true, useV2Actions, hasInlineComments: true })).toBe(
        true,
      )
    }
  })
})
