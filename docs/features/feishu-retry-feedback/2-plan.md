feat-id: feishu-retry-feedback
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 改动清单

| 文件 | 改动 |
|---|---|
| `prompt-dispatcher.ts` | Waiter 加 `retryCount/onRetry/faMs/fireFastfail`;register 加第 4 参 onRetry;dispatch 认 `session.status` retry(计数 + 回调 + 重置 fastfail 窗口);fastfail 文案带重试次数;导出 `RetryNotice` / `FASTFAIL_ERROR_MARKER` |
| `retry-notify.ts` | 新增纯逻辑:`shouldNotifyRetry`(首条立即 / ≥90s / ≤3 条)+ `retryNoticeText` |
| `message-pipeline.ts` | `createRetryNotifier(chatId)`;runOpencode 第 5 参 onRetry + 4 调用点接线;fastfail catch 后防御式 `session.abort?.`;`friendlyErrorReply` 重试终态 pattern(timeout 分支前) |
| 测试 ×3 | prompt-dispatcher.test.ts(T1-T4,T7)/ retry-notify.test.ts(T5)/ friendly-error.test.ts(T6) |

## 决策轨迹

- 核心 0 改动:`session.status` retry 事件链(processor status.set → plugin hook → dispatcher.dispatch)现成可用,只在 adapter 侧消费。
- 施工注意⑤落地:retry 事件重置 fastfail 窗口 = `clearTimeout + setTimeout(fireFastfail, faMs)`,仅当 firstActivityHandle 仍活跃(真实 part 已到过则不重装,不影响 30min 硬超时语义)。
- 终态 pattern 只认「已自动重试 / overloaded」:503 已有既有 5xx pattern;零重试 fastfail 文案(含「如 503 重试」字样)保持走原 timeout 分支,既有测试零改动。
- abort 防御式 `session.abort?.bind(...)`:测试 fake / 老 SDK 无此方法时跳过 —— 首跑全量测试撞出 fake 无 abort 抛 TypeError 顶掉原错误,已修。
- 节流状态放 pipeline 层(每 turn 一个 notifier 闭包),dispatcher 保持无状态透传,职责分明。
