feat-id: feishu-retry-feedback
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动记录

## commit

- (本笔 commit)`feat(feishu): REQ-093 LLM 重试期播报 + retry 重置 fastfail + fastfail 后 abort [feat: feishu-retry-feedback]`(分支 feat/daily-ux-batch)

## 实际改动

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/prompt-dispatcher.ts` | +60 | retry 事件消费(计数/回调/重置 fastfail 窗口)+ 文案带重试次数 + FASTFAIL_ERROR_MARKER |
| `packages/adapter-feishu-lark/src/feishu/retry-notify.ts` | +31(新) | 播报节流纯逻辑 |
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | +70 | createRetryNotifier + runOpencode onRetry 接线(4 调用点)+ fastfail 后防御式 abort + friendlyErrorReply 重试终态 pattern |
| 测试 ×3 | +130 | T1-T7(dispatcher 5 + notify 4 + friendly 2) |

## 影响范围

- 全部 fork-only adapter 包;核心 0 改动;0 上游黑名单 / 0 R4。
- 行为变化:① 重试期飞书收到「正在自动重试(第 N 次)」(节流 ≤3 条/turn);② fastfail 窗口按「距上次 activity/retry 事件」计(消除边播报边硬杀矛盾);③ fastfail 判死后 best-effort abort 终止后台无限重试;④ 重试耗尽/overloaded 有明确终态文案。

## 回归测试

- adapter 全量 792 pass / 0 fail;typecheck 绿。既有 fastfail/timeout/5xx 文案测试零改动全绿。
- T8(真机 mock 503)/ T9(REQ-086 联动 blocker:workspace=真实项目时事件仍可达)随发版真机验收。abort 后核心 retry 定时器是否残留在 T8 一并观察。

## 回退方法

单 commit `git revert`;dispatcher register 新参数为可选,revert 后调用方兼容。
