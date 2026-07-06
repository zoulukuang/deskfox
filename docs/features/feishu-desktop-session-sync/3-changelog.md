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

## 取名路径的更正(2026-07-06,user 纠偏 + 二次实测)

先前把「拿昵称」误当成「必须开 `contact:user.base:readonly`」。二次真机实测(投资CFO)钉死**取名有多条路,scope 非必需**:

| 场景 | 路径 | 要 contact scope 吗 |
|---|---|---|
| 群 session「谁说的」(第 6 项) | `GET /im/v1/chats/{chat}/members`(实测返 name「搞量化的小贝」)/ 消息 mention 数据 | ❌ 免 scope,现成 |
| 合并转发子消息 sender(REQ-055) | 子消息只带 `sender.id` 且发言人未必在当前 chat → 只能查 `contact/v3/users/batch` | ✅ **仅此一处**;不开回落前缀 |

→ **结论**:`contact:user.base:readonly` **只对「合并转发里非当前 chat 成员的真名」是锦上添花,核心功能不需要**。已建的 `contact-name-resolver`(contact API + graceful 回落)对合并转发正确;**第 6 项群呈现面应改走 chat-members(免 scope)**,不用通讯录 API。

## 第四批:REQ-073-⑥ 群 session 发送者昵称(注入式,commit `24e3f520c7`)

user 拍板走**注入式**(把发送者真名前缀进 user message,桌面见谁说的 + bot 知道谁在说,契合已认可的群上下文带入特性)。

- `contact-name-resolver.ts` 加 `resolveChatMemberNames(chatId, client)`:分页 `GET /im/v1/chats/{id}/members`,**免 contact scope**(实测直接返 name),graceful 回落。
- `message-pipeline.ts` `getGroupSenderName`:群消息发送者真名,**10min TTL per-chat 缓存**;handle() 里 `promptText` 前注入 `[真实昵称]: <内容>`;p2p / 查不到 → 无前缀(旧行为一致)。
- +5 单测(U10/U10b/U10c 分页各态 + U11/U11b)。**adapter 760 全量回归绿**。

## 真机端到端验收(2026-07-06,本地版重建 + 投资CFO)

重建 feishu 插件 bundle(`build-feishu-plugin.sh` → `plugin.js` 4.4MB,grep 特征串确认新代码入包)→ 拷进本地版 `.app/Contents/Resources/plugin/feishu-bridge/dist/` → **仅重启本地版**(正式版 PID 49812 全程存活未碰)→ `/debug/simulate-message` 注入(不依赖真 WSS,非侵入)。

| 项 | 验收手段 | 结果 |
|---|---|---|
| ① 停归档 | 新建 session 查 `opencode-local.db` `time_archived` | ✅ **空(未归档)** → 进侧栏 |
| ④ bot title | 查 session `title` | ✅ **`[投资CFO] Feishu p2p/83304075`** |
| ② 跨重启接续 | 重启本地版 → 同 chat 再发 → 比对 session id | ✅ **复用 `ses_0cacb46e`**(store 回读生效,旧行为会新建) |
| ⑤ 授权反向失效 | 需真 permission 流 | 单测覆盖(U5/U6);真机 permission 流未单独跑 |
| ⑥ 群昵称 | chat-members 真机返 name(前已实测「搞量化的小贝」)+ 单测 U10/U11 | 逻辑已证;真群 e2e 受 DB 隔离限制未单跑 |

⚠️ 验收在本地版(`opencode-local.db`),与正式版 DB 隔离;测试 chat 条目已从共享 store 清理。

## 第五批:合并转发 chat-members 优先增强(commit `22140bb4af`)

真机实测发现 contact/v3/users 对**全部在可见范围内**用户仍返 `name=None`(chat-members 同人返真名),疑线上版本未含 `contact:user.base:readonly` 或管理后台字段可见性限制(后台开关看着开,API 不返 name)。user 拍板**不阻塞此问题**,加一层免-scope 兜底:

- 抽 `getChatMemberNames`(TTL 缓存)+ `resolveSenderNames`:**chat-members 优先(免 scope,同群转发立即拿真名)→ 剩余非当前 chat 成员才落 contact/v3/users 兜底**;两层全 graceful。
- 合并转发 `senderNames` 改走 `resolveSenderNames`。+2 单测(U12/U12b)。762 全量绿。

## 第 3 项桌面续聊 — 0 前端改动确认

前端**无任何按 Feishu/来源过滤会话**;侧栏唯一过滤 `server-sync.tsx:297 .filter((s) => !s.time?.archived)`。第 1 项停归档后飞书会话自动过此过滤进侧栏;续聊 = 普通 prompt(不回推飞书天然成立,桌面 prompt 走 opencode 原生无飞书出站)。→ **第 3 项 0 前端改动成立**。

## 六项落地汇总(全 fork-only,0 上游 / 0 R4)

| 项 | 落地 commit | 测试 | 真机 |
|---|---|---|---|
| ① 停归档 | `5fb269166c` | U2 | ✅ e2e |
| ② 跨重启接续 | `7a1076d143` | U1b | ✅ e2e |
| ③ 桌面续聊 | 0 改动(①派生) | 前端过滤分析 | ✅ |
| ④ bot title | `5fb269166c` | U3/U3b | ✅ e2e |
| ⑤ 授权反向失效 | `5fb269166c` | U5/U6 | 单测 |
| ⑥ 群+合并转发昵称 | `350e/24e3/22140` | U7-U12b | 真 API + 单测 |

**22 专属单测 + adapter 762 全量 0 fail + typecheck 绿。**

## bug 修复:跨-DB dangling session 挂死(commit `73ce2862e0`,真机自动化测试发现)

user 反馈 InveM🐼-Mac 账号在本地版发消息 → session 无最新记录 + 每条「LLM 回复超时 240000ms 无输出」。**根因 = 第 2 项 store 回读的回归**:

- `chatSessionStore` 按 chatId **全局共享**(单文件 `~/.opencode/feishu-chat-sessions.json`),但 `sessionID` 是 **DB 作用域**:`local` 渠道用 `opencode-local.db`、发布三档共享 `opencode.db`(规范 §3.11)。
- 本地版回读到 store 里 **prod 建的 session id**(实测 InveM 全部 9 个 chat 的 session 均 prod-db 有、local-db 无)→ `promptAsync` 对本 DB 不存在的 id **挂死 240s 首字节超时**,GUI 也不显示。
- 日志实锤:`reuse persisted session ses_X → opencode prompt 首字节超时 (240000ms)`。

**修法**:`getOrCreateSession` 回读后经 `sessionExists`(`session.messages` 查 HTTP 状态)校验在当前 DB 存在才复用;404/异常/非 200 一律弃用改新建(宁可丢一次跨重启上下文,不冒挂死)。

**真机验证闭环**:① 修复前 reuse dangling→240s 超时;② 修复后 `弃用改新建 → new session (local-db) → prompt 出回复(msg 2 行)`;③ 再重启 → 有效 local session 正常 `reuse`(item 2 复用未被破坏)。+2 单测(U13 bug-repro / U13b)。adapter 764 全量绿。

## 全面自动化回归小结(2026-07-06)

- 单测:24 专属 + adapter **764 全量 0 fail** + typecheck 绿。
- 真机(本地版 + `/debug/simulate-message`):①②④ 过 + 跨-DB bug 修复闭环验证。
- 日志扫查:REQ-073 相关 0 新异常;5 账号 WSS 全连。
- **附带发现(非本版)**:`media-gen EADDRINUSE 51737` = 本地版/正式版双实例抢 media-gen 固定端口(既有多实例限制,另立条目)。

## 标题改进:与桌面端一致的描述性标题(commit `bcfac7d0ef`,user 反馈)

user 反馈静态标题 `[botName] Feishu p2p/<chatId尾8位>` 的 chatId 尾号对人无意义,看不出会话在聊啥。改为向桌面端命名方式对齐:

- **根因**:opencode 标题自动生成(`prompt.ts` 用小模型 LLM 生成描述性标题)**仅当 title 是默认值("New session - <ISO>")时触发**(`isDefaultTitle` 门控);adapter 设了静态 title 就被跳过。
- **修法**:① 创建时**不设 title** → opencode 用默认标题 → 触发桌面同款 LLM 自动生成;② `ensureBotTitlePrefix` 惰性给生成后的标题补 `[botName]` 前缀(多 bot 同群仍可区分,done Set 短路 + 幂等);③ 自动生成是 `forkIn` 异步不保证及时,`scheduleTitlePrefix` 6s 后仍默认标题(gen 未完成 / **provider 超时**,即问题 2)→ 用 `deriveTitleHint`(首条消息片段 / 文件名)**确定性兜底**,永不停在 "New session -"。
- **真机验证**(投资CFO):`[投资CFO] Feishu p2p/83304075` → `[投资CFO] 帮我梳理一下2026年Q3的投资组合再平衡计划`(本次因问题 2 走了兜底路径,标题=首条消息;provider 给力时会是 LLM 摘要)。
- +6 单测(U3/U3b-U3f)。adapter **768 全量绿**。
- ⚠️ **存量旧会话不回改**(已是非默认标题,`ensureBotTitlePrefix` 跳过);仅新建会话享描述性标题。如需批量修旧标题另说。

## bug-repro:合并转发发言人昵称在两条路径都没识别出来(user 真机反馈,截图 + session `ses_0ca151cd9ffe6N6nN9ENlNBTV3`)

user 转发「笑南与李哲的会话记录」合并卡片到「投资CFO」bot 后追问,发现**没把发言人昵称/id 识别出来,未达需求目标**。dump session 定位到两条独立 bug:

- **问题①(引用/回复路径,内容整个丢失)**:引用那张合并卡片再追问时,`fetchParentMessageText`(message-pipeline.ts)对 `merge_forward` 类型父消息只走 fallback `return [${msgType}]` → 吐字面量 `[merge_forward]` 空壳,**从不调 `fetchMergeForwardItems` 展开子消息**。session `[4]/[6]` 实证 LLM 收到的就是 `[引用原文]\n[merge_forward]\n[/引用原文]`,bot 读不到内容还误判"转发没粘上"。
- **问题②(直接转发路径,昵称被剥光)**:`withSender = event.chatType !== "p2p"`。跟 bot 单聊(p2p)时 `withSender=false` → flatten 不加发言人前缀 → REQ-055 的 sender 名解析根本没被触发。session `[2]` 实证 4 行纯正文无 `[笑南]:`/`[李哲]:`,bot 在 `[9]` 只能"猜至少两个人"。判断逻辑本身错:合并转发内容天生是"多人会话记录",发言人姓名与外层是否 p2p 无关。

**修法**(全 fork-only,`packages/adapter-feishu-lark/src/feishu/message-pipeline.ts`,0 上游侵入):
- 抽出纯函数 `parseQuotedMessageText(msg)`(从 `fetchParentMessageText` 剥离 text/post/image/file 解析,Q1-Q5 单测不变);
- 新增 `resolveQuotedContext(event)` 统一引用入口:**一次 `message.get`** 拿父消息,`merge_forward` → 复用同一次 get 结果的子消息 + `flattenForwardConversation` 展开(问题①);其余走 `parseQuotedMessageText`;全程 graceful;
- 新增 `flattenForwardConversation(items, event)` 共享底座(handleMergeForward + 引用路径共用),**`withSender` 恒 true**(问题②);昵称走 `resolveSenderNames`(chat-members 免 scope → contact API 兜底 → 回落 open_id 前缀);
- `handleMergeForward` 改用该底座(删掉 `withSender = chatType!=="p2p"` 分支 + 重复的 flatten/expandNested 拼装),step 11 图片计数 `flatten.imageCount` → `conv.imageCount`。

**测试**:+3 集成复现单测(MF-Q1 引用 merge_forward 展开内容不再空壳 / MF-Q2 引用带发言人前缀 / MF-Q3 p2p 直接转发发言人不再被剥光)。adapter **771 全量 0 fail** + typecheck 绿。

**真机验证(2026-07-06,本地版 + 投资CFO)**:重打插件包换进本地版 → 飞书 WSS `synced 5/5`。同一张「笑南与李哲的会话记录」卡片:① 直接转发 → 回复带发言人标注(不再"猜两个人");② 引用/回复再追问 → bot 读到内容并带发言人(不再吐 `[merge_forward]` 空壳)。user 确认通过。

**能力边界(问题③,待真机确认)**:飞书 `message.get` 的 sub-message 只带 `sender.id`,不带 display name。当前 chat 成员(如笑南)走 chat-members 免 scope 拿真名;群外/陌生人(如李哲)需 `contact:user.base:readonly` scope,未授权回落 open_id 前缀 —— 本修复已把该拿到的都拿到,陌生人真名点亮取决于 scope,留真机验证。

## bug 修复:真群 e2e 暴露的两个确定性 bug(P1 标题竞态 + P3 群昵称回落,真机「测试用的一个群」+ InveM🐼-Mac)

2026-07-06 user 真群跑 ⑤⑥,dump session `ses_0c9b77dfeffe...` + 读本地版 DB 坐实两个 adapter bug:

- **P1 标题竞态**(`[fix: feishu-title-prefix-race]`):群 session 当前标题 = `日常闲聊`,**丢了 `[InveM🐼-Mac]` 前缀**。根因:旧 `scheduleTitlePrefix` 只 6s 后**一次性**——那时 gen 未完成就设 `[botName] <hint>` 并置 `titlePrefixDone`;之后 opencode 的 LLM 自动生成标题**迟到**把标题覆盖成无前缀的 `日常闲聊`,因 done 已置 → `ensureBotTitlePrefix` 短路 → 前缀永久丢失。**修法**:`scheduleTitlePrefix` 改为**轮询等 gen**(累积 ~90s):每 tick 调 `ensureBotTitlePrefix`,仍默认 → 不 done 继续等;gen 完成变描述性 → 补前缀并 done;**只有轮询到头 gen 仍没来才用 hint 兜底**。消除"先设 hint 再被 gen 冲掉"的竞态。重试节奏 `titleRetryDelays` 可实例覆盖供单测。

- **P3 群昵称回落**(`[fix: feishu-group-sender-fallback]`):DB 铁证群消息存的是纯 `说句话吧`,**无 `[笑南]:`**。根因:chat-members API 返 `code=99991672 Access denied` —— **InveM🐼-Mac bot 没开 `im:chat*` scope**(`im:chat:readonly`/`im:chat.members:read` 任一)。旧 `getGroupSenderName` 查不到 → 返 null → 群消息**完全无前缀** → 多人群全员匿名。**修法**:查不到时**回落 open_id 前 6 位**(对齐合并转发 senderTag),保证多人群每条消息至少带可区分标签。
  - ⚠️ **纠正旧结论**:此前"chat-members 免 scope"不准——它**需要 `im:chat*` scope**,之前测的投资CFO 恰好开了、InveM 没开。**真名点亮需 user 给 bot 开 `im:chat:readonly`**(飞书后台),回落前缀是缺 scope 时的 graceful 兜底。

**测试**:+4 单测(U3g 竞态复现:gen 迟到覆盖→轮询补回前缀不停在无前缀 / U3h 轮询到头 hint 兜底 / U14 群昵称回落 open_id 前缀 / U14b p2p 返 null);更新 1 处群 mention 测试断言(群消息现带发言人前缀)。adapter **775 全量 0 fail** + typecheck 绿。

## bug 修复:P2 桌面授权 404 —— 方案 A 优雅降级(真机复现 + CDP 自测通过)

真机复现(测试用的一个群 + InveM🐼-Mac):桌面 GUI 点权限卡「允许一次」→ 弹「请求失败 Permission request not found: per_xxx」;同一条在飞书点则成功。

**根因(实证钉死)**:opencode 是**每个目录 instance 一个独立 server + 独立 permission store**(内存态,证据:进程环境里 ~90 个不同 `OPENCODE_SERVER_PASSWORD`;`permission/index.ts` pending 走 `InstanceState.make`)。而飞书 plugin 在 `plugin.ts:99` 写死「第一个 instance 的 client 用作所有 pipeline」→ 飞书权限创建在 plugin 宿主 instance;桌面 GUI 按 session 目录连的是另一个 instance server → 桌面 respond 打到的 pending 里没这条 → 404。`permission.asked` 是全局广播,所以卡片能在桌面**显示**、但**响应**打错 instance。飞书自己 in-process client resolve 命中同 instance → ✅。

**方案 A(user 拍板,先治标)**:桌面 GUI `decide` 的 `.catch` 对 "Permission request not found" **静默降级**,不弹吓人的错误 toast(权限本应在发起端飞书确认,且会随 `permission.replied` 全局事件让桌面卡片自动消失)。改 `packages/app/src/pages/session/composer/session-composer-state.ts` 一处 `.catch`(+FORK marker,~6 行)。

**CDP 端到端自测通过**:重建本地版(renderer 进 asar)→ simulate 触发真权限 → GUI live 收事件弹卡 → 点「允许一次」→ **无错误 toast**(修前有);该权限仍 pending(证明桌面 404 跨-instance 路径确被走到、被静默吞掉)。截图 `/tmp/verify_before.png`(卡片在)/`/tmp/verify_after.png`(点后无 toast)。

**未做(方案 B,follow-up)**:让桌面能**真授权**飞书权限,需飞书 pipeline 改用每账号目录 scoped 的 client(让权限落在 GUI 能到的 instance),触及飞书桥核心 client 路由、稳定性风险高,`稳定 > 一切` 下另立结构改任务。现形态:**权限统一在飞书授**,桌面不再报错、卡片正常消失。

## 待办(仅剩流程)

- **P2 桌面授权 404**(飞书 resolve 后桌面 GUI 卡片不撤 → 再点报 "Permission request not found"):疑 opencode 原生 GUI 未响应外部 `permission.replied` 自动撤卡(纯 opencode GUI+TUI 双端也会),不在 adapter 修复范围,待查上游 GUI。
- **P4 bot 幻觉**(问 meta 问题时 glob `**/*` 读了 OpenClaw 源码 `/Users/openclaw/openclaw` 给错答案):偏 agent 行为/prompt,待评估轻量缓解(收紧 imbot 项目外读 / 加提示)。
- **P3 真名**:待 user 给相关 bot 开 `im:chat:readonly` scope 后真名自动点亮(现回落 open_id 前缀)。
- 问题③(合并转发陌生人真名):同理需 `contact:user.base:readonly`,user 已拍板先不处理。
- feat 分支 push / 合 main 待 user 拍板。

## 回退方法

feat 分支整体未合 main;单笔回退 `git revert <hash>` 即可(一笔一主题)。
