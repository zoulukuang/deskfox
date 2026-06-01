feat-id: feishu-llm-timeout-surface
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 飞书桥接 LLM 超时 / 空响应 surface 修复

## 起源(用户故事 / 故障 case)

2026-05-31 用户 + 同学撞同一故障:**飞书 bot 收到消息但完全不回**(单 bot 影响,同账号下其他 bot 正常)。诊断发现根因链路:

```
LLM 请求 hang(provider 链路异常,如 OAuth 失效 / 5xx / 限速)
  ↓ 30 分钟过去
dispatcher timeout → 拿 partial(空)→ resolve("")
  ↓
runOpencode 拉 session.messages → 找不到 useful assistant → 返 ""
  ↓
handle() 拿到 finalText="" → console.warn + return  ← 静默丢弃
  ↓
飞书侧:bot 完全没回(用户视角"bot 死了")
```

**核心问题**:整条链路上的"空 reply"被当成正常状态吞掉,**用户拿不到任何反馈**,不知道是网络问题、provider 故障、超时、还是被拒。

## 验收标准

### AC1 — Dispatcher timeout 区分有 partial vs 完全空
- timeout 时**有累积 partial text** → 沿用现有行为(返 partial,标记 source=`timeout-partial`)
- timeout 时**无累积 partial** → reject 带明确 timeout error message,message 里含 `(timeoutMs 数值)` 便于日志诊断

### AC2 — runOpencode 不再静默返空字符串
所有返空字符串的路径全部改 throw 友好 Error:
- `session.messages` HTTP 失败 → throw "无法读取 LLM 回复(session.messages 失败 status=N)"
- `data.length === 0` → throw "opencode session 为空(LLM 未产出任何消息)"
- `findLastUsefulAssistant` 返 undefined → throw "本轮 LLM 无 useful 输出(可能权限被拒 / provider 链路异常 / 超时降级)"
- `timeout-partial 但 partial 为空` → throw "LLM 调用超时且无任何输出(timeoutMs=N)"

### AC3 — handle() / handleMergeForward() empty reply 也要 surface
当 `finalText.trim() === ""` 走到 handle 末尾 fallback 路径(理论上 AC2 后不该走到,作 belt-and-suspenders),发一条 fallback 文本而非 return。

### AC4 — friendlyErrorReply 覆盖 5 类新 error pattern
- timeout / 超时 → 友好"模型超时,稍后重试"
- 429 / rate limit → "provider 限速"
- 502 / 503 / 504 → "provider 暂不可用"
- "LLM 无 useful 输出" / "未产出" → "可能权限被拒或链路异常"
- "session.messages 失败" / "session 为空" → "内部状态读不到"

每类 case 末尾保留原始错误 message(便于诊断)。

### AC5 — 用户最终行为
**任何情况下**(包括所有 throw 路径)用户最终都会在飞书收到一条 reply,不再有"bot 死了"。

## 不在范围(留后续)

- **2026-05-31 同期发现**:dispatcher partial 累积包括 user 自己 prompt 的 text part(代码注释里的 known bug),导致 reply echo。不在本 spec,留 followup feat-id `feishu-dispatcher-echo-fix`。
- **dispatcher 超时机制本身的重构**(订阅 message.updated + time.completed 字段判完成)— 当前 30min 启发式超时是 Layer 2 重构范畴,本 spec 不动 timeout 阈值。
- **LLM provider 健康检查 / fallback**(自动切备用 provider)— 产品策略问题,留另一个 feat 讨论。

## 改动规模评估

- prompt-dispatcher.ts: ~15 行(register 返回类型 + timeout 行为)
- message-pipeline.ts: ~30 行(runOpencode 多个 throw + handle/handleMergeForward fallback + friendlyErrorReply 增强)
- prompt-dispatcher.test.ts(**新建**): ~80 行(6+ 测试场景)
- friendly-error.test.ts: ~30 行(5 类新 case + 修原 `Network timeout` 用例期望)
- message-pipeline.test.ts: ~30 行(empty reply fallback 兜底 e2e)

**总计 ~180 行,Medium 改动**(50-500 行单一主题)— 走三文档 SOP,本 spec 不需 user 改前审签(改的全是 fork-only 包,0 上游侵入)。

## 测试纪律 (R5)

- **复现测试先**(bug fix 强约束):dispatcher timeout-empty / runOpencode no-useful 这两条核心路径的测试**先写**、commit message 标 `[bug-repro: bot 收到消息后 30 分钟超时静默丢弃 → 用户拿不到任何反馈]`
- 不引入新 lint 规则,不动主分支铁律

## 上游侵入度

**0 行上游改动**。adapter-feishu-lark 整包 fork-only(2026-05-08 起),不需 FORK marker(R2 例外)。
