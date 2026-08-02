feat-id: feishu-retry-feedback
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-093 飞书 LLM 可重试错误重试期间无反馈

## 需求

LLM provider 返回可重试错误(503/overloaded/rate-limit)时,opencode 核心自动重试(无次数上限,退避可长达数分钟),期间飞书侧 bot 完全沉默 —— 用户体感「机器人死了」,比明确报错更伤信任。

## 现状(源码复查实锤)

- 核心每次重试都 `status.set({type:"retry",attempt,message,next})` → `session.status` 事件 → plugin hook → `dispatcher.dispatch`,**信号已可达 adapter,无需改核心**;
- adapter 侧 `dispatch` 只认 `message.part.updated` / `session.idle` / `session.error`,retry 事件被丢弃;
- feishu 侧已有 240s 首字节 fastfail(`prompt-dispatcher.ts`),但它不认识 retry 事件 → 二次复核发现的时序矛盾:退避 >240s 时会边重试边被 fastfail 硬杀。

## 方案(定稿,纯 adapter 层)

1. dispatcher 认识 `session.status` retry:计数 `retryCount`、回调 `onRetry`、**retry 事件视为 activity 重置 fastfail 首字节窗口**(施工注意⑤,距上次 activity/retry 超 240s 才硬杀);fastfail 错误文案在有重试时拼「已自动重试 N 次」;
2. `message-pipeline` 每个 runOpencode 调用点传节流通知器:飞书发「⏳ AI 服务繁忙,正在自动重试(第 N 次)…」,节流 = 首条立即、之后距上条 ≥90s、单 turn ≤3 条;
3. `friendlyErrorReply` 新增重试终态 pattern(已自动重试/overloaded/503),放 timeout 分支之前(fastfail 文案同时含「超时」「已自动重试」,顺序敏感);
4. fastfail reject 后 best-effort `session.abort` 终止后台无限重试防僵尸(仅 fastfail 路径;正常 30min 超时路径不 abort,partial 语义不变)。

## 测试用例(R8,动工前锁定)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| T1 | 注入 `session.status` retry 事件 → onRetry 收到 attempt/message | unit | 回调触发 |
| T2 | retry 事件重置 fastfail 窗口:faMs 内收 retry → 窗口重开,不 reject | unit | 施工注意⑤ |
| T3 | retry 后仍无任何 activity 超窗 → reject,错误文案含「已自动重试 N 次」 | unit | fastfail 带重试上下文 |
| T4 | 真实 part 活动已清 fastfail 后,retry 事件不再重装定时器 | unit | 不误伤长任务 |
| T5 | 节流:连续 retry 事件 → 首条立即,90s 内不重发,单 turn ≤3 条 | unit | 通知器纯逻辑 |
| T6 | `friendlyErrorReply`「已自动重试」/overloaded/503 → 重试终态文案(且不被 timeout 分支抢) | unit | 新 pattern |
| T7 | 无 waiter 的 session 收到 retry 事件 → 静默忽略 | unit | 防御 |
| T8 | 真机 mock 503 provider:重试期飞书收到状态消息,耗尽后收到终态 | 真机 QA | 验收门槛 |
| T9 | 【blocker】账号 workspace=真实项目时 retry 事件仍可达(plugin ctx.directory 一致性) | 真机 QA | 与 REQ-086 联动 |

## 影响范围

`prompt-dispatcher.ts` / `message-pipeline.ts`(均 fork-only adapter 包)。abort 后核心是否残留 retry 定时器在 T8 一并观察。
