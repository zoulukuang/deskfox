feat-id: feishu-llm-timeout-surface
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 飞书桥接 LLM 超时 / 空响应 surface 修复

> commit: (本笔)
> 规模:Medium(~180 行,4 文件改 + 1 文件新建 + 3 文档)
> 影响:adapter-feishu-lark 包 fork-only,0 改上游

## 起源

2026-05-31 用户 + 同学撞同一故障:飞书 bot 收到消息但完全不回。诊断报告见 [`memory/task-feishu-no-reply-investigation.md`](?) 及 `OPENCODE-PLAN/诊断工具/DeskFox-tools/DeskFox-Diag.ps1` v6.3 段。根因:**LLM 调用 30 分钟超时 → dispatcher 走 partial 路径返空 → runOpencode 拉 session.messages 找不到 useful → 返空字符串 → handle() 静默 return,飞书侧 0 reply**。

## 改动总览

```
packages/adapter-feishu-lark/src/feishu/
  ├── prompt-dispatcher.ts                     +37 -10
  ├── message-pipeline.ts                      +85 -15
  └── __tests__/
      ├── prompt-dispatcher.test.ts            +172 (新建,10 case)
      ├── friendly-error.test.ts               +57 -8
      └── message-pipeline.test.ts             +120 (新增 4 e2e case)

docs/features/feishu-llm-timeout-surface/
  ├── 1-spec.md                                +84
  ├── 2-plan.md                                +44
  └── 3-changelog.md                           +130
```

## 1. prompt-dispatcher.ts

### 1a) `register()` 返回类型升级 `Promise<string>` → `Promise<DispatchResult>`
新增 export interface:
```typescript
export interface DispatchResult {
  reply: string
  source: "session.idle" | "timeout-partial"
}
```
source 字段让上层 `runOpencode` 能区分"正常 idle 完成"vs"超时降级返 partial",决定是否走 session.messages 兜底拉 final。

### 1b) timeout 行为微调
`if (partial)` → `if (partial.trim())`。语义更显式:任何 whitespace-only partial 也一律 reject(否则上层 session.messages 兜底还是会拉空,徒增延迟)。timeout 但有真实 partial 时 resolve `{ reply, source: "timeout-partial" }`,无 partial 时 reject 带"`opencode prompt timeout (Nms) — LLM 在超时窗口内无任何输出`"。

### 1c) 修一个 pre-existing bug(superseded reject 永不触发)
`register()` 二次调用同 sessionID 时:之前先 `this.waiters.delete(sessionID)` 再 `existing.reject(superseded_err)`,但 reject 路径走 finalize 闭包,finalize 内 `this.waiters.get(sessionID)` 已是 undefined → 早 return → OLD promise 永不 reject(内存泄漏 + 调用方 hang)。修法:去掉显式 delete,让 finalize 自己完成 delete + reject。`prompt-dispatcher.test.ts` 的 "superseded" case 锁住正确行为。

## 2. message-pipeline.ts

### 2a) `runOpencode` 改"返空字符串"为 throw + timeout-partial 兜底
之前 4 个返空字符串的分支全改 throw:

| 路径 | 旧行为 | 新行为 |
|---|---|---|
| `wrap.data` 缺失 | `return ""` | timeout-partial 有 reply → 返 partial;否则 throw "opencode session.messages 读取失败..." |
| `data.length === 0` | `return ""` | timeout-partial 有 reply → 返 partial;否则 throw "opencode session 为空..." |
| `findLastUsefulAssistant` 返 undefined | `return ""` + console.warn | timeout-partial 有 reply → 返 partial;否则 throw "本轮 LLM 无 useful 输出..." |
| `assistantEntry.info.error` 已是 throw,无改动 | (沿用) | (沿用) |

throw 一路冒到 handle() 的 catch → `sendFeishuText(friendlyErrorReply(err))`,用户在飞书一定收到一条说明文本。`timeout-partial 兜底返 partial` 是优先级最高的分支 — partial 是 LLM 真实产出的内容,比 fallback 文本更有信息量,优先用。

### 2b) `friendlyErrorReply` 新增 5 类 pattern
- `本轮 LLM 无 useful 输出` / `LLM 未产出` → "🤔 LLM 这轮没产出任何回复 — 可能权限被拒 / 链路异常 / 超时降级"
- `session.messages 读取失败` / `session 为空` → "🔌 DeskFox 内部读不到 LLM 回复(sidecar 状态异常),建议重启 DeskFox"
- `timeout` / `超时` / `无任何输出` / `30 分钟超时` → "⏱️ LLM 模型回复超时,常见原因:模型繁忙 / OAuth 失效 / 网络抖动"
- `429` / `rate limit` / `ratelimit` → "🚦 LLM provider 限速了"
- `502` / `503` / `504`(全词边界匹配) → "⚠️ LLM provider 暂时不可用"

每类末尾保留 `(原始错误:${msg})` 便于线下诊断。

**⚠️ if 顺序敏感**:no-useful / session-state 比 timeout 更具体,必须放在 timeout 之前 — `本轮 LLM 无 useful 输出(... 30 分钟超时降级)` 这种含"超时"两字的 error 会被 timeout 分支抢先匹配。`friendly-error.test.ts` 用 "30 分钟超时降级" case 锁住顺序。

### 2c) `EMPTY_REPLY_FALLBACK` 兜底
新增 export 常量。`handle()` / `handleMergeForward()` 收到 `finalText.trim()===""` 时(理论上 2a 之后不该走到,作 belt-and-suspenders),发 EMPTY_REPLY_FALLBACK 文本而非静默 return。覆盖 processAttachments 把 `[ATTACH:xxx]` 剥光后剩纯空白的极端情况。

## 3. 测试

### 3a) 新建 `prompt-dispatcher.test.ts`(R5 Logic 清单补齐)
10 case 覆盖:
- session.idle 正常路径 → resolve DispatchResult
- session.error(有 message / 无 message)→ reject
- **[bug-repro]** timeout 无 partial → reject(锁住核心修复)
- timeout 有 partial → resolve `{ source: 'timeout-partial' }`
- timeout buffer 完全空 → reject 带 timeoutMs 数值(诊断信息)
- 同 sessionID 二次 register → 旧的 reject('superseded') 新的独立(锁住 pre-existing bug 修复)
- abortAll → 所有 pending reject('dispatcher aborted')
- delta 增量累积
- 非 text part(reasoning / tool)→ 忽略

prompt-dispatcher 之前 0 测试覆盖,这次补齐进 R5 Logic 清单。

### 3b) `friendly-error.test.ts` 增量
- 修原 `"Network timeout after 30s"` 用例期望(从默认 fallback 升级到 timeout 友好提示)
- 加 7 新 case 覆盖 5 类 pattern + 边界(no-useful 抢先 timeout / session 为空 落 no-useful 文案)

### 3c) `message-pipeline.test.ts` 增量(4 e2e case)
全在新建的 describe "LLM 超时 / 空响应 surface" 块下:
- **[bug-repro]** dispatcher timeout 无 partial → 用户收到 "⏱️ LLM 模型回复超时" 而非 0 reply
- dispatcher session.error(401)→ 用户收到 "❌ API key 可能无效"
- session.messages 返空 + idle → 用户收到 "🤔 LLM 这轮没产出"
- dispatcher timeout 有 partial → 用户直接收 partial 文本(不抛错,保留现有 partial 兜底)

## 验证

```
$ bun test src/feishu/__tests__/prompt-dispatcher.test.ts
 10 pass / 0 fail / 16 expect() calls / 165ms

$ bun test src/feishu/__tests__/friendly-error.test.ts
 14 pass / 0 fail / 34 expect() calls / 74ms

$ bun test src/feishu/__tests__/message-pipeline.test.ts
 65 pass / 0 fail / 144 expect() calls / 1131ms

$ bun test (全 adapter-feishu-lark 包)
 646 pass / 0 fail / 1245 expect() calls / 4.18s

$ bun run typecheck (全 monorepo)
 17/17 successful
```

## 影响范围

- **fork-only**:adapter-feishu-lark 包整包 fork-only(2026-05-08 起),0 改上游,无 FORK marker 需求(R2 例外)。
- **0 R4**:无黑名单 override。
- **二进制契约**:`PromptDispatcher.register` 签名变更,返回类型 `Promise<string>` → `Promise<DispatchResult>`。包内唯一调用方 `MessagePipeline.runOpencode` 已同步更新。包外无消费者(adapter-feishu-lark 不导出 PromptDispatcher 类),无破坏性影响。

## 回归测试

- 飞书桥接全部既有 e2e 测试 622 → 646 pass(+24 新 case)。
- typecheck 全 monorepo 17/17。
- 飞书 bot 收到正常消息 → 正常回复(由原 `message-pipeline.test.ts` /new + /group + processAttachments 等 60+ case 覆盖,无回归)。

## 回退方法

`git revert (本笔 commit)`。回退后:
- `register()` 回退到 `Promise<string>` 签名
- runOpencode 回到"返空字符串"行为
- handle() empty reply 回到静默 return
- friendlyErrorReply 失去 5 类新 pattern
- pre-existing superseded bug 复活

## 已知 follow-up(不在本 spec)

- **dispatcher 累积 part 包括 user 自己 prompt 文本**(echo bug,代码注释里 2026-05-09 已知):本次没修,需要按 message role 区分,留 feat-id `feishu-dispatcher-echo-fix`。
- **dispatcher 超时机制重构**(订阅 message.updated + time.completed 字段判完成,告别启发式 30min 超时):Layer 2 重构,本次不动 30min 阈值。
- **LLM provider 健康检查 / fallback**(自动切备用 provider):产品策略问题,留另一个 feat 讨论。
