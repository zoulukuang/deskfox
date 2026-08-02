// [fork-only] REQ-093 重试播报节流(纯逻辑,Logic 清单)
// [feat: feishu-retry-feedback] 2026-08-02
//
// 核心自动重试无次数上限,retry 事件可能高频到达;播报节流防刷屏:
// 首条立即、之后距上条 ≥90s、单 turn 最多 3 条。

export interface RetryThrottleState {
  sentCount: number
  lastSentAt: number
}

export const RETRY_NOTIFY_MIN_GAP_MS = 90_000
export const RETRY_NOTIFY_MAX_PER_TURN = 3

export function shouldNotifyRetry(
  state: RetryThrottleState,
  now: number,
  opts: { minGapMs: number; maxPerTurn: number } = {
    minGapMs: RETRY_NOTIFY_MIN_GAP_MS,
    maxPerTurn: RETRY_NOTIFY_MAX_PER_TURN,
  },
): boolean {
  if (state.sentCount >= opts.maxPerTurn) return false
  if (state.sentCount === 0) return true
  return now - state.lastSentAt >= opts.minGapMs
}

export function retryNoticeText(attempt: number): string {
  return `⏳ AI 服务繁忙,正在自动重试(第 ${attempt} 次)…`
}
