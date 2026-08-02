// [feat: feishu-retry-feedback] REQ-093 T5 — 播报节流纯逻辑
import { describe, expect, test } from "bun:test"
import { retryNoticeText, shouldNotifyRetry, type RetryThrottleState } from "../retry-notify"

const OPTS = { minGapMs: 90_000, maxPerTurn: 3 }

describe("shouldNotifyRetry(REQ-093 节流)", () => {
  test("T5a: 首条立即放行", () => {
    const s: RetryThrottleState = { sentCount: 0, lastSentAt: 0 }
    expect(shouldNotifyRetry(s, 1_000_000, OPTS)).toBe(true)
  })

  test("T5b: 距上条 <90s 拦截,≥90s 放行", () => {
    const s: RetryThrottleState = { sentCount: 1, lastSentAt: 1_000_000 }
    expect(shouldNotifyRetry(s, 1_000_000 + 89_999, OPTS)).toBe(false)
    expect(shouldNotifyRetry(s, 1_000_000 + 90_000, OPTS)).toBe(true)
  })

  test("T5c: 单 turn 已发 3 条 → 永久拦截(即使超 90s)", () => {
    const s: RetryThrottleState = { sentCount: 3, lastSentAt: 0 }
    expect(shouldNotifyRetry(s, 10_000_000, OPTS)).toBe(false)
  })

  test("T5d: 文案含次数", () => {
    expect(retryNoticeText(2)).toContain("第 2 次")
    expect(retryNoticeText(2)).toContain("自动重试")
  })
})
