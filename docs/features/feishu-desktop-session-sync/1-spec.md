feat-id: feishu-desktop-session-sync
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 飞书↔桌面同 session 协同呈现 — 1-spec

> 归版:[飞书↔桌面同 session 协同呈现版(v2026-07-05-2)](../../../../OPENCODE-PLAN/版本计划/v2026-07-05-2.md)
> 需求权威:REQ-073 [飞书会话桌面端呈现](../../../../OPENCODE-PLAN/需求池/飞书会话桌面端呈现.md) + REQ-055 [飞书合并转发-sender昵称](../../../../OPENCODE-PLAN/需求池/飞书合并转发-sender昵称.md)
> 规模:**Large**(6 子项 + 昵称底座,含 🔴 真飞书·真机成分)→ **本 spec 需 user 审签后才动工**
> 建立:2026-07-06

---

## 〇、一句话定性

飞书发起的会话在桌面端**可见、可续聊、上下文连续**;桌面是**汇总 / 控制端**;桌面侧发言**不回推飞书**,但飞书↔桌面**共享同一条 session 的上下文**。

## 一、范围(六项 + 底座)

| # | 子项 | 档位 | 我可自主完成 | 需真飞书 / 真机 |
|---|---|---|---|---|
| 1 | 停止自动归档 | 🟡 | ✅ 删 4 处 archive 调用 + 单测 | 侧栏可见性抽查 |
| 2 | 跨重启接续 | 🔴 | ✅ 查找回读 `chatSessionStore`(代码本身安全) | **10 分钟 auth/读盘运行时实验**(钉死 ①) |
| 3 | 桌面续聊同 session | 🟡 | 解归档后前端本就可见可续聊,预期 0 前端改动(待核) | 续聊·不回推飞书真机验 |
| 4 | title 加 bot 昵称 | 🟡 | ✅ 抽 `getOrCreateSession` helper + 4 处统一 + 单测 | 两 bot 同群不撞脸抽查 |
| 5 | 授权双端反向失效 | 🔴 | ✅ plugin.ts 订阅 `permission.replied` + `handleExternalResolve` + 单测 | 双端齐弹竞态真机验 |
| 6 | 群发送者昵称 | 🔴 | ✅ 昵称底座代码骨架(端点做成可回落) | **端点真凭证实测钉死**(钉死 ⑥) |
| 底座 | REQ-055 open_id→昵称 | 🟡 | ✅ 通讯录 API 客户端 + 缓存 + graceful 回落 + 单测 | 合并转发子消息真机验 |

**OUT OF SCOPE**(user 已拍板):不改群 session 存储模型 / 不做群对话汇总 / 桌面回复不回推飞书 / 不新增「飞书会话」侧栏分组 / opencode 后端预期 0 改动。

## 二、改动清单(已 grep 核实,行号随漂移以 grep 为准)

全部落在 **fork-only adapter 包 `packages/adapter-feishu-lark`**,预期 **0 上游侵入 / 0 黑名单 / 0 R4**。

### 2.1 `feishu/message-pipeline.ts`(第 1/2/4 项 — 核心重构)

现状:4 处**近乎逐字重复**的「查找 → 创建 → 落盘 → archive」块:
- 主文本 `:882-913`(title `:888` / archive `:899`)
- merge_forward `:1069-1096`(title `:1074` / archive `:1082`)
- 文件消息 `:1324-1351`(title `:1329` / archive `:1337`)
- 图片文件 `:1575-1595`(title `:1581` / archive `:1589`)

**改法**:抽共用私有方法 `getOrCreateSession(event): Promise<string | null>`,4 处调用点统一替换。helper 内:
1. **查找**(第 2 项):先 `this.chatToSession.get(chatId)`;miss 再**回读 `this.opts.chatSessionStore.get(accountId, chatId)`**(现只读内存 Map,从不回读已落盘 store);命中则回填内存 Map。
2. **创建**:title 改 `[${botName}] Feishu ${chatType}/${chatId.slice(-8)}`(第 4 项,botName 取 `this.opts.account.botName`,缺省回落无前缀)。
3. **落盘**:`chatSessionStore.set(...)`(保留)。
4. **不再 archive**(第 1 项):删除 4 处 `archiveSession(...)` 调用;`archiveSession` 私有方法 `:2057` 是否保留由「有无其它调用者」决定(grep 确认后处置)。
5. **错误处理**:沿用现有 `sendFeishuText(friendlyErrorReply) + return null`,调用点判 null 即 return。

### 2.2 `plugin.ts`(第 5 项 — 订阅反向失效)

现状 `:113-145` 只订阅 `permission.asked` → 路由到 `pipeline.hasSession(sessionID)` → `handlePermissionAsked`。

**改法**:同结构新增 `permission.replied` 分支 → 路由到拥有该 session 的 pipeline → 调用 `pipeline.handlePermissionReplied({ requestID })` → 透传到 `PermissionCardController.handleExternalResolve`。

### 2.3 `feishu/permission-card.ts`(第 5 项 — 外部解决态)

现状 `PermissionCardController`:`pending` Map / `handleReply`(= `replaceWithSettledCard` + `cleanup` + `replyToOpencode`)/ `handleTimeout`。

**改法**:新增 `handleExternalResolve(requestID, reply)`:查 `pending` → 命中则 `replaceWithSettledCard(entry, reply)` + `cleanup(requestID)`,**不调 `replyToOpencode`**(解决动作已源自 opencode/GUI 侧,幂等后端二次 reply 会 404)。pending 无此 requestID = no-op(已被本端处理过)。

### 2.4 昵称底座(第 6 项 + REQ-055)

- 新文件 `feishu/contact-name-resolver.ts`:`resolveOpenIdNames(openIds, larkClient): Promise<Map<open_id, name>>`。端点**施工前实测钉死**(候选:批量 `GET /contact/v3/users/batch?user_ids=...&user_id_type=open_id` 或逐个 `GET /contact/v3/users/{user_id}?user_id_type=open_id`,取 `name`);pipeline 执行内缓存;查不到 **graceful 回落 open_id 前 6 位**。
- 消费面 A(REQ-055):`merge-forward-flatten.ts:senderTag()` 由查表替换截断。
- 消费面 B(第 6 项):群 session 呈现发送者昵称(具体呈现落点施工时定)。
- Bot 权限:需 `contact:user.base:readonly` scope(飞书后台配置,非代码)。

### 2.5 前端 `packages/app`(第 3 项)

预期 **0 改动**:停自动归档后飞书 session 即普通可见 session,复用现有侧栏 / 时间线 / prompt / permission(GUI 已订阅 `replied`)。施工时核实确无需改;若需「飞书会话」区分则**不在本版**(OUT OF SCOPE)。

## 三、施工前待钉死(动工前必须先处理)

| # | 事项 | 谁做 | 阻塞哪项 |
|---|---|---|---|
| ① | 10 分钟运行时实验:历史 sessionID 带 auth+directory `GET /session/{id}/message` 返 200(纯读盘收工)还是 401(顺 auth 再排) | 需真飞书运行环境 → **请 user 协助或授权在其环境跑** | 第 2 项精确修法 |
| ⑥ | 通讯录端点真凭证实测钉死(`batch_get_id` 疑为反向接口) | 需真 bot 凭证 → **请 user 协助** | 第 6 项 + REQ-055 |
| ⑦ | 双端并发写同 session 行为(排队/busy/交错) | 需真飞书运行环境 | 真机脚本覆盖 |
| ② | 底座先于两个消费面 | 我(排期) | — |
| ③ | 授权只补飞书订阅这一段,后端不改 | 我(已确认) | — |
| ④⑤ | 主侧栏混入 / 群上下文渗入 = 已接受权衡 / 特性 | 无需处理,doc 标注 | — |

## 四、验收门槛(R8 测试用例清单 — 动工前锁定)

### Logic 清单(单元测试,行覆盖 ≥ 80%)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| U1 | `getOrCreateSession`:内存 miss + store 命中 → 复用旧 sessionID,不新建 | unit | 返回旧 id,`session.create` 未调用 |
| U2 | `getOrCreateSession`:内存 miss + store miss → 新建,写内存+store,**不 archive** | unit | `archiveSession` 未调用,store.set 调用 |
| U3 | `getOrCreateSession`:title 含 `[botName]` 前缀;botName 缺省 → 无前缀回落 | unit | title 断言两态 |
| U4 | `getOrCreateSession`:create 抛错 → 发飞书友好错误 + 返回 null | unit | sendFeishuText 调用,返回 null |
| U5 | `handleExternalResolve`:pending 命中 → settled + cleanup,**不调 replyToOpencode** | unit | replyToOpencode 未调用,pending 删除 |
| U6 | `handleExternalResolve`:pending 无此 requestID → no-op 不抛 | unit | 静默返回 |
| U7 | `resolveOpenIdNames`:全部命中 → 正确 Map | unit | 名字映射正确 |
| U8 | `resolveOpenIdNames`:部分/全部查不到 → 回落 open_id 前 6 位,不抛 | unit | 回落断言 |
| U9 | `senderTag`:有映射查表 / 无映射回落前 6 位 | unit | 两态断言 |

### View / 真机清单(🔴,需真飞书·真机,一套操作脚本覆盖)

| # | 用例 | 门槛 |
|---|---|---|
| E1 | 停自动归档后新建飞书会话**出现在桌面侧栏** | 🔴 |
| E2 | 桌面在飞书 session 续聊 → 同一 session、飞书下次带上下文、**不回推飞书** | 🔴 |
| E3 | 重启 sidecar 后同 chat 续聊**复用旧 session、上下文不断** | 🔴 |
| E4 | 两 bot 同群 title 各带 `[botName]` **不撞脸**(含 merge_forward/文件/图片 4 路径) | 🔴 |
| E5 | 桌面/TUI 先解决 → **飞书卡片自动失效**;双端齐弹竞态不重复执行 | 🔴 |
| E6 | 群会话 + 合并转发子消息显示真实昵称;查不到回落 open_id 前缀不报错 | 🔴 |
| E7 | 归档回归:无 gc/清理/统计依赖飞书 session 的 archived 态(出库复核) | 核查 |
| E8 | 双端并发写行为符合钉死 ⑦ 结论 | 🔴 |

## 五、健康指标预估

- 上游侵入:**0**(全 fork-only adapter + 可能 0 前端改动)
- R4 override:**0**
- 新增行数 / 改上游行数:∞:0(全新文件 + fork 包内改)
