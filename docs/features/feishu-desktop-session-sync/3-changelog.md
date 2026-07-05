feat-id: feishu-desktop-session-sync
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 飞书↔桌面同 session 协同呈现 — 3-changelog

## 第一批:可自主部分(第 1/4/5 项 + helper 重构)— 未 commit

分支 `feat/feishu-desktop-session-sync`。全落 fork-only adapter `packages/adapter-feishu-lark`,**0 上游侵入 / 0 R4 / 0 黑名单**。

### 改动文件

| 文件 | 改动 | 对应 |
|---|---|---|
| `feishu/message-pipeline.ts` | 抽私有 helper `getOrCreateSession(event)`,统一 4 处近乎逐字重复的「查找→创建→落盘→archive」块;删除 4 处调用点内联逻辑;删除已无调用者的 `archiveSession` 私有方法;新增 `handlePermissionReplied` 路由方法 | ①④⑤ |
| `feishu/permission-card.ts` | 新增 `handleExternalResolve(requestID, reply)`:pending 命中 → `replaceWithSettledCard` + `cleanup`,**不调 `replyToOpencode`** | ⑤ |
| `plugin.ts` | event hook 新增 `permission.replied` 分支 → 按 `hasSession` 路由到 pipeline → `handlePermissionReplied` | ⑤ |
| `feishu/__tests__/desktop-session-sync.test.ts` | 新增 7 个单测(U1-U6 + U3b) | ①④⑤ |

### 实现要点

- **REQ-073-① 停自动归档**:`getOrCreateSession` 新建 session 后**不再** `archiveSession`;`archiveSession` 方法及其 4 处调用全部删除 → 飞书会话变普通可见 session,进桌面侧栏。落盘 `chatSessionStore.set` 保留。
- **REQ-073-④ bot 昵称 title**:title 由 `Feishu ${chatType}/${chatId.slice(-8)}` → `[${botName}] Feishu ...`;`botName` 取 `this.opts.account.botName?.trim()`,缺省回落无前缀(与旧 title 逐字一致)。
- **REQ-073-⑤ 授权双端反向失效**:`plugin.ts` 订阅后端广播的 `permission.replied`(载荷 `{sessionID, requestID, reply}`)→ 拥有该 session 的 pipeline → `handleExternalResolve` 把飞书卡片改 settled 态并从 pending 删除;**跳过 `replyToOpencode`**(解决动作已源自 opencode 侧,后端幂等,二次 reply 会 404)。后端 0 改动。
- **helper 抽取**:4 处调用点由 ~30 行内联块统一成 2 行(`const sessionID = await this.getOrCreateSession(event); if (!sessionID) return`),净减重复代码,防「改一处漏三处」(REQ-073 复核就补了后两处)。

### 测试

- 新增单测 `desktop-session-sync.test.ts` **7 pass**(U1 内存复用 / U2 不 archive / U3 带前缀 / U3b 缺省回落 / U4 创建失败回落 null / U5 外部解决卡片失效不回放 / U6 未知 requestID no-op)。
- adapter 全量回归 **747 pass / 0 fail**;typecheck 通过。

### 与 1-spec 的偏差(诚实记录)

- **U1 测试实现为「内存复用」而非「store 回读」**:第 2 项跨重启接续的 store 回读被**刻意推迟**到「施工前待钉死①」的 auth 运行时实验有结论后再补 —— 避免历史 session 若返 401 造成续聊回归。`getOrCreateSession` 已预留回读点(注释标注)。

## 第二批:钉死实验 + 第 2 项(commit `7a1076d143`)— 真机(投资CFO 账号)

2026-07-06 user 提供真飞书环境(投资CFO,accountId `cli_a916d5631f619bc7`),跑通 ①⑥ 钉死实验。

### 钉死① 跨重启接续(auth vs 读盘)— 定案

- 手段:`GET /debug/fetch-messages`(走 adapter 真实 opencodeClient + directory 调 `session.messages`)。
- 结果:历史 session `ses_0d8aeee8dffe…` 返 **404 NotFoundError**,**非 401**;authHeader 被接受。
- 归因:404 系**跨-DB 假象** —— 本地版 sidecar 查 `opencode-local.db`,而该 session 在**正式版 `opencode.db`**(实测该 DB 有 1 行 + message 2 行,`time_archived` 非 0 印证自动归档)。
- **结论**:旧注释「因 InstanceState 不预 load 而 401」经实证是**误判**;真凶只是查找不回读 store,与 auth 无关。store 回读纯读盘、安全。
- 落地:`getOrCreateSession` 内存 miss 时回读 `chatSessionStore.get` 复用旧 session(第 2 项完成)。
- ⚠️ 测试注意:**本地版/正式版 DB 隔离**,真机端到端验第 2/3 项须在实际桥接该账号的实例做。

### 钉死⑥ 通讯录端点 — 定案

- **正确端点**:`GET /contact/v3/users/batch?user_ids=…&user_id_type=open_id`(批量 ≤50)或单个 `.../users/{id}`,吃 open_id、可返 `name`。
- **`batch_get_id` 确认是反向接口**(email/mobile→id,需 `contact:user.id:readonly`),做不了 open_id→昵称。
- **⚠️ blocker**:投资CFO app 当前**缺 `contact:user.base:readonly` scope** → 调用 code 0 但只返 `open_id/union_id/mobile_visible`,`name` 被字段级 scope 门控挡空。需 user 在飞书后台开通该 scope + 发布版本。
- **捷径**:`GET /im/v1/chats/{chat_id}/members` **无需额外 scope 即返 name**(实测拿到「搞量化的小贝」)→ 群 session 发送者昵称(第 6 项)可优先走此接口,通讯录 API(+scope)留给合并转发任意用户(REQ-055 面)。

## 第三批:昵称底座 + REQ-055 合并转发面(commit `350e8773cf`)

- 新增 `contact-name-resolver.ts`:`resolveOpenIdNames(openIds, client)` — tokenManager 取 token + Bun-native fetch 打 `GET /contact/v3/users/batch?user_id_type=open_id`(SDK 此构建不暴露 contact 模块,复用 `file-uploader` 既有模式)。全程 graceful:name 非空才入表 → 缺 `contact:user.base:readonly` scope / 不在可用范围 / 请求失败 均回落 open_id 前缀。
- `merge-forward-flatten.ts`:`FlattenOptions` 加可选 `senderNames`,`senderTag`/`renderSubMessage`/`flattenMergeForward` 透传(纯函数保持可测),命中真名否则回落前 6 位。
- `message-pipeline.ts` `handleMergeForward`:群场景解析 sender 真名传入 flatten + 嵌套复用。
- +7 单测(U7/U8/U8b/U8c resolver 各态 + U9/U9b/U9c flatten 查表)。**adapter 755 全量回归绿**。

## 待续

- **REQ-073-⑥ 群 session 呈现面**(呈现落点):底座已就绪,但「群主路径把 sender 真名注入 session」这一落点会改 LLM 看到的 prompt 内容(影响 bot 行为),待 user 定夺方案后落地。可选:chat-members 免 scope 接口取名。
- **scope 开通**(user 侧):投资CFO app 开通 `contact:user.base:readonly` + 发布 → REQ-055 合并转发真名自动点亮(现回落前缀)。
- 第 3 项桌面续聊:待真机验证 0 前端改动。
- 全部 🔴 真机验收(E1-E8);⚠️ 须在实际桥接账号的实例(注意本地版/正式版 DB 隔离),需重建本地版 sidecar 载入新代码。

## 回退方法

feat 分支整体未合 main;单笔回退 `git revert <hash>` 即可(一笔一主题)。
