---
feat-id: e2e-chat-loop
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# e2e-chat-loop — 2-plan

> 实施轨迹 + 踩坑沉淀。本笔接手 WIP commit `11ada4f02`,3 case 都 fixme 状态、跑不通,要先定位 fail 真因再修。

## 起手前提

- WIP commit:`packages/app/e2e/chat-loop.spec.ts`(316 行,3 case)+ `e2e/mocks/chat-mock.ts`(298 行 SSE/会话/消息 mock helpers)
- 3 case 全 `test.fixme()`,接手起步:把 C1 改回 `test()` → 跑 → 看 fail 信号 → 一层层下钻

## 实施步骤

### Step 1 — 摸基础设施 + 确认 UI selector 真实存在

`chat-loop.spec.ts` 用了 `[data-component="session-turn"]` / `[data-slot="session-turn-assistant-content"]` / `[data-component="prompt-input"]` / `[data-action="prompt-submit"]` / `[data-component="session-progress"]` / `[data-session-id="..."]`。

第一次 grep `packages/app/src` 没找到 session-turn,差点判 selector 已过期 — 但实际它在 `packages/ui/src/components/session-turn.tsx`(SessionTurn 组件从 `@opencode-ai/ui` 导入)。**结论**:全 selector 都活,问题不在 selector,在 mock。

### Step 2 — 跑 C1,捕获真信号

加请求 logger + console error capture + page snapshot 读取。3 轮迭代得到:

**轮次 1**:`waitForUserMessage` timeout。page snapshot 看到 "Connect provider" 卡 + "Select model" button → submit 处 (`submit.ts:307`) 因 `!currentModel || !currentAgent` toast 返回。

**轮次 2(根因深挖)**:打开请求 logger 看到 `GET /agent?directory=...` 但 `MOCK_AGENTS` 走的是 `**/app/agents` 路径 — **路径错了**,实际是 `/agent`。同时所有 per-project 调用都带 `?directory=...` query,而 chat-mock 用 `**/agent` / `**/provider` / `**/session` glob **不匹配**带 query 的 URL → 全部 fallthrough 到 catch-all 返 `[]`。

**轮次 3**:全改 RegExp `/\/foo(\?|$)/` → URL 跳到 `/session/<id>` ✓ user msg 出现 ✓,但 assistant 不出来。

### Step 3 — SSE 真传不到 page,定位 + 修

加 `console.log` 在 chat-mock SSE 钩子里 — 没打印。原 WIP 用 `route.fulfill({body: sseGenerator()})` 但 Playwright body 只接 string/Buffer,async generator 被 toString 成 `[object AsyncGenerator]`,SDK SSE parse 当垃圾扔掉,所以 push 没人收。

改 `addInitScript` 路线:

```ts
await page.addInitScript(() => {
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
  window.__deskfoxE2eSSE = { controllers, push(events) { ... } }
  const origFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = ... // 提取 URL
    if (url.includes("/global/event")) {
      return new Response(new ReadableStream({ start(c) { controllers.push(c); ... } }), { ... })
    }
    return origFetch(input, init)
  }
})
```

测试侧:`page.evaluate((evts) => window.__deskfoxE2eSSE.push(evts), events)` 推帧。

加 `page.evaluate` 验 SSE state(`sseInstalled` / `controllerCount` / `fetchPatched`)— 三个全 true,所以是上层别的问题。

### Step 4 — Assistant 渲染条件:parentID + tokens 必备

SSE 接通后又翻 ErrorBoundary,这次错位 `tokenTotal()` 读 `msg.tokens.input` 触发 `undefined.input`。

回 `session-context-metrics.ts` + `session-turn.tsx` 摸渲染契约,锁定两个硬性 shape 要求:

1. assistant message 必须带 `parentID === userMessage.id` — 否则 SessionTurn 的 `assistantMessages()` 过滤为空,`[data-slot="session-turn-assistant-content"]` 整段不 mount
2. assistant message 必须带完整 `tokens: { input, output, reasoning, cache: { read, write } }` + `cost` — 否则 `tokenTotal()` 在 `lastAssistantWithTokens` 遍历时崩

把 `createMockAssistantMessage` 升级带这些字段,加 `parentID?` 参数。C1 立刻过。

### Step 5 — C2/C3 顺势修

**C2**:session.created event 必须带顶层 `directory` field,否则 global-sdk 路由到 "global" channel(per-project sync 不订阅) → 数据进不了项目 store。补一行 `directory: DIRECTORY` 即过。

还撞到一个 strict mode 报错:`data-session-id` 在 sidebar + recents panel 两处都 render,`toBeVisible()` strict mode 因为匹配 2 个 element 失败 — 加 `.first()`。

**C3**:同 C1 sweep + 补 assistant message 的 parentID,过。`progress` idle 后的 hiding 动画转场不稳定,只断言 busy 阶段 visible,idle 后 hidden 留给 unit。

### Step 6 — 清理 debug instrumentation + 三文档收尾

C1 的 SSE state probe / 请求 logger / modelBtn check 都是攻坚阶段加的,过验收后清理。chat-mock.ts 的 console.log 也清理。保留 `errors` 数组 + fatal filter,做最终 sanity check。

## 关键踩坑沉淀

1. **Playwright glob 不兜 query string** — 任何 per-project endpoint 都带 `?directory=`,要 mock 必用 RegExp `/\/foo(\?|$)/`
2. **`route.fulfill({body})` 不接 stream/generator** — SSE 必走浏览器端 `addInitScript` patch fetch + ReadableStream
3. **assistant message mock 的最小 shape** — `parentID` + `tokens` + `cost` 三件套缺一不可
4. **session.created event 必须带顶层 `directory`** — 否则 per-project sync 收不到
5. **多 surface 都 render `data-session-id`** — sidebar + recents 都有,断言用 `.first()`

## 测试纪律对照

按 R5 v3.1:

- 新 feat,Medium 量级(~614 行 spec + helper),要求 ≥ 1 e2e — 本笔过(C1 即 happy path,C2/C3 加成)
- View 清单门槛(SolidJS 组件 e2e happy path)— 本笔等于补 chat 主链路的 view 覆盖,先于其他 view feat 一步落地
