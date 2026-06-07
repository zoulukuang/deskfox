feat-id: feishu-llm-stall-fastfail
status: done
related: ./3-changelog.md

# 飞书桥接 — LLM 首字节快速失败(防单条卡死消息堵死整个聊天)

> 规模:Tiny+（dispatcher 核心 ~40 行 + 测试 ~90 行,fork-only,0 上游侵入）
> 分支:`fix/feishu-llm-stall-fastfail`（从 main 起）
> 起源:2026-06-07「搞量化的小贝」账号真机排查

## 一、Bug 现象

飞书账号收到消息后**彻底静默、整个聊天失联,只能重启 sidecar 才恢复**。

## 二、根因

1. LLM provider(getbot）返回**可重试错误**(HTTP 503 `system cpu overloaded`),opencode 内部按指数退避**重试 ~9 分钟**,期间**不发任何 message.part、也不报 session.error**。
2. dispatcher 只有单一 `timeoutMs`（默认 30min）硬超时 → 这 9~30 分钟一直干等。
3. WSS handler 是 `await chatQueue.enqueue(chatId, …)`（同 chat **串行**),第一条卡死消息把**整个聊天队列堵死**,后续消息全排在后面进不来(日志只有 `dedup skip` 没有 `msg from chat`);WSS 因 `await` 不返回 → 飞书收不到 ack → 反复重投。
4. 净效果:该聊天彻底失联直到重启。

## 三、修复

`prompt-dispatcher.ts` 新增**「首字节活动」快速失败**:

- `register(sessionID, timeoutMs, firstActivityTimeoutMs = 120_000)` 第三参（默认 120s,上限取 `min(fa, timeoutMs)`）。
- 注册时除原 `timeoutMs` 硬超时外,另起一个 `firstActivityHandle` 定时器。
- dispatch 收到**任意** part（text / reasoning / tool,放在 text 过滤之前）→ 视为"provider 已响应" → 清除该定时器。
- 若 firstActivity 窗口内**毫无 part** → 判定 provider 卡死 → 提前 `reject`,error 文案含「首字节超时」+「无任何输出」→ 命中 `friendlyErrorReply` 的 timeout pattern → 飞书侧回「⏱️ 模型回复超时，建议稍后重试/换 model」。
- `finalize` / supersede / `abortAll` 均同步清理 `firstActivityHandle`,无 timer 泄漏。

**效果**:卡死 chat 从「30min 堵死」缩短到「~120s 自动失败 + 给用户反馈 + 释放队列」(15×)。正常长任务在几秒~几十秒内必有 part 活动 → 清除定时器,**不误杀**。

**零改 opencode core / 零改 pipeline**（pipeline 现有 `register(sessionID, timeoutMs)` 调用自动吃默认 firstActivity）。

## 四、改动文件

| 文件 | 改动 |
|---|---|
| `feishu/prompt-dispatcher.ts` | Waiter 加 `firstActivityHandle`;`register` 加第三参 + firstActivity 定时器;dispatch 首 part 清除;finalize/abortAll 清理;导出 `DEFAULT_FIRST_ACTIVITY_TIMEOUT_MS` |
| `feishu/__tests__/prompt-dispatcher.test.ts` | +6 用例(快速失败提前 reject / 文案命中 / 活动取消 / reasoning 也算活动 / 默认上限） |
| `feishu/__tests__/friendly-error.test.ts` | +1 用例(首字节超时文案 → 模型超时友好提示） |

## 五、测试

- adapter `bun test`:**711 pass / 0 fail**（+7 断言）;typecheck **17/17**。
- 纯逻辑改动,单元测试完整覆盖(无 native / 真 sidecar 面 → 不需真桌面 QA)。
- `[bug-repro]`：「首字节窗口内毫无 part → 提前 reject 不等满 timeoutMs」锁住核心修复。

## 六、回退

`git revert` 单 commit 即可;无 part 时回退到原 30min 硬超时行为。

## 七、关联 backlog

`OPENCODE-PLAN/需求池/飞书桥接-LLM可重试错误重试期间无反馈.md` —— 本 fix 落地了其中「方案 2:重试上限/总时长封顶」的 dispatcher 侧。仍可继续做的:重试期间「正在重试…」过渡提示（方案 1）。
