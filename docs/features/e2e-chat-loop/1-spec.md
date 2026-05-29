---
feat-id: e2e-chat-loop
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# e2e-chat-loop — 1-spec

> **聊天主循环 Phase 1 mock e2e 套件** — 覆盖 user 视角下"新建 session → 发消息 → 收 AI 回复"完整链路 + sidebar 新 session 出现 + busy 期 progress 指示器显示。

## 需求来源

`e2e-phase1-mock-mode` 基础设施已 done(commit `352f90991`),其上已有 mock-foundation smoke + bug-repro 3 例。chat-loop 是 DeskFox 的核心 user flow,但 mock e2e 套件之前没覆盖到 — 改 prompt-input / sync reducer / session-turn 任何一处 reactive 链路,需 user 手动验。本笔补这块。

2026-05-29 早上一笔 WIP commit(`11ada4f02`)有半成品 spec + mock helper,3 case 全 `test.fixme()` 状态。本笔接手修通 + 收尾文档。

## 验收标准

| ID | 场景 | 期望 |
|---|---|---|
| **C1** | new session 发消息 → user msg + AI 回复 | 在新工作区按 user 真路径:打字 → 提交 → URL 跳到 `/<dir>/session/<id>` → 看到自己消息(optimistic)→ SSE 推 assistant message + text part → AI 回复出现 |
| **C2** | sidebar 收到新 session | SSE 推 `session.created`(带 `directory`)→ sidebar 项目下出现 `[data-session-id="<id>"]` 节点 |
| **C3** | busy 期 progress 显示 | 提交后 SSE 推 `session.status: busy` → `[data-component="session-progress"]` 可见;接 message.updated + idle → assistant 文本到达 |
| **C4** | 全部 spec | `bun run --cwd packages/app test:e2e` 跑 chat-loop.spec 全过,fatal errors = 0(SSE reconnect / FETCH-FALSY-REJECTION 等 mock 环境常态噪声 filter 掉) |
| **C5** | mock helper 复用性 | `mocks/chat-mock.ts` 可被未来 chat 相关 spec(如 followup / abort / retry)直接复用,无需复制粘贴路由 |

## 架构选型

复用 Phase 1 已建的 `installServerMock` + `bootstrapMock`,扩一份 `mocks/chat-mock.ts` 专门覆盖聊天链路特有的 endpoint + SSE。

### 关键技术决策

#### D1 — 所有 chat-mock 路由用 RegExp,不用 glob

Playwright `**/foo` glob **不匹配** 带 query string 的 URL(`?directory=...`)。SDK v2 走 `x-opencode-directory` header 透传 directory,但**很多** endpoint 同时也接 `?directory=` query(GET /agent / GET /provider / GET /session / GET /path / ...)。原 WIP commit 用 `**/foo` glob,所有 per-project 调用全 fallthrough 到 catch-all 返 `[]`,导致 agent list 为空 / model 没选 → submit 卡 model/agent 检查 → session 创建从未触发。

新文件一律用 `/\/foo(\?|$)/` regex 兜两形态。

#### D2 — SSE 用 `addInitScript` 浏览器端 `fetch` patch,不用 `route.fulfill({body: asyncGen})`

Playwright `route.fulfill({body})` 只接 `string | Buffer`,原 WIP 用 async generator 不生效(被 toString 成 `[object AsyncGenerator]`,SDK parse 失败)。

改为浏览器侧 `window.fetch` 拦截 `/global/event`,返 `Response(ReadableStream)`,把 controller push 到 `window.__deskfoxE2eSSE.controllers`。测试侧通过 `page.evaluate(... window.__deskfoxE2eSSE.push(events))` 往 stream enqueue 帧 — 真 SSE 协议,SDK 端无感。

#### D3 — assistant message mock 必须带 `parentID + tokens + cost`

SessionTurn 用 `parentID === userMessage.id` 做 turn 内 assistant 消息归组,缺它 `assistantMessages()` 过滤为空,`[data-slot="session-turn-assistant-content"]` 整段不渲染。

`session-context-metrics.tokenTotal()` 无脑读 `msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write`,缺 tokens → `undefined.input` 抛 → ErrorBoundary 全屏崩。

mock 必须给完整 shape。

#### D4 — Phase 1 mock 模式,不引入真后端

跟 mock-foundation / bug-repro 系列一致。Phase 2 真桌面 e2e 是另一条线(那条 cover 视觉对齐 + native dialog),mock e2e 关心 reactive + UI 行为,不联调真 opencode-cli。

## 关键模块清单分类

按 R5 v3.1 双清单:

- **Logic 清单**:`mocks/chat-mock.ts` 的 helper(`createMockSession` / `createMockUserMessage` / `createMockAssistantMessage` / `createMockTextPart` / `buildChatFlowEvents`) — 纯数据构造,可单测覆盖
- **View 清单**:`chat-loop.spec.ts` 3 case 本身 — 至少 1 个 e2e happy path(本笔 C1 即是,过验收)

不引入新组件、不动 view layer 源码 — 测试套件本身就是 view layer 的覆盖载体。

## 不在本笔范围

- abort / retry / followup 用例(后续 chat e2e 套件扩)
- 真 SSE 重连场景(mock SSE 不模拟断线 — heartbeat fallback 路径靠 unit 覆盖)
- progress 在 idle 后的 hiding 动画行为(`[data-state=hiding]` 转场不稳定,留给 unit)
- Phase 2 真桌面 chat 联调(opencode-cli sidecar 走通后再开)
