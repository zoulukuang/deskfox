feat-id: stuck-working-status-reconcile
status: done
related: ./3-changelog.md

# stuck-working-status-reconcile — changelog

## 一句话

修复会话主视图永久卡「思考中」+ 停止按钮关不掉:根因与 2026-06-06 的 [`stuck-working-indicator-fix`](../stuck-working-indicator-fix/3-changelog.md) **不同路径** —— 那次修的是**消息**缺 `time.completed`(侧边栏旋转图标);这次卡的是**后端 `session_status` 停在 busy 没回 idle**(主视图思考中)。前端 `session_status` 是后端同步来的缓存,后端那份是纯内存:进程被硬杀 / 生成中途断流 / sidecar 看门狗重启时,后端来不及(或新进程根本不知道要)补发 `session.status idle`,前端那条乐观 busy 永远刷不掉。唯一的对账点 `bootstrap.ts` 又用裸 `setStore`(merge)清不掉残留 key。

## 根因链

1. 发消息时前端乐观把 `session_status` 设 busy(`submit.ts`),`promptAsync` 只入队就返回,回 idle 全靠后端事件。
2. 后端死 / 事件丢 → idle 事件不来 → 前端永久 busy,无超时无兜底。
3. `session_status` 后端是纯内存 Map(`status.ts`),sidecar 重启即清空,不会为它不知道的 session 补发 idle。
4. 前端唯一重新拉 `session.status()` 对账的地方(`bootstrap.ts:279`,重连/重 bootstrap 会走到)用的是裸 `setStore("session_status", data)` —— SolidJS 对象 setter 是 merge,后端只返回非 idle 会话,残留的 `ses_X:busy` 因「新数据没提它」而永远清不掉。
5. 停止按钮 `halt` 走 `session.abort().catch(()=>{})` 纯吞错,abort 失败时无任何反馈 → 「点击关闭关不掉」。

## 改动文件

| 文件 | 变更 | 说明 |
|---|---|---|
| `packages/app/src/context/global-sync/session-status-reconcile.ts` | 新增(FORK-ONLY,~50 行) | `reconcileSessionStatus`(纯函数:算权威表 + 列残留)+ `applyReconciledSessionStatus`(写回 store:reconcile 整体替换 + console.warn 留痕);判定与写回全收进 fork-only,bootstrap 注入只 1 行 |
| `packages/app/src/context/global-sync/session-status-reconcile.test.ts` | 新增 | 7 用例:残留 busy 清除(复现) / 后端 busy 保留 / idle 过滤 / null 容错 + 真实 solid store 证明「裸 merge 清不掉、reconcile 才清」+ **端到端跑 bootstrap 实际调用的 `applyReconciledSessionStatus`**(根因守门) |
| `packages/app/src/context/global-sync/bootstrap.ts` | 改 1 行(+FORK marker) | `session.status()` 对账改用 `applyReconciledSessionStatus(input.store, input.setStore, x.data)`,清残留 busy |
| `packages/app/src/pages/session.tsx` | 改 `halt`(+FORK marker) | abort 失败不再静默吞错,弹真实 toast;残留 busy 交对账自愈 |
| `packages/opencode/src/server/routes/instance/session.ts` | 改(+FORK marker,**R4 override**) | 把 `heal-interrupted` 接到桌面端真正命中的两条分支(标准路由 GET messages 的 no-limit + 分页首页 `before===undefined`)→ idle 时补盖残骸 + 落 DB。修复 2026-06-06 heal 错放 httpapi+no-limit 致桌面双重死代码的根因 |

## 🔑 根因(机制级,2026-06-12 深挖):2026-06-06 后端 heal 对桌面端是「双重死代码」

「会话在不在运行」前端由两个独立信号判定,后端兜底都没接到桌面端真正走的路径:
1. **路由错位**:`heal-interrupted` 仅挂 **HTTPAPI handler**;桌面 sidecar 锁 `prod` channel → HTTPAPI 关(`flag.ts:16` 仅 dev/beta/local 默认开,`instance/index.ts:50` 仅 flag 开时挂 httpapi 路由)→ 桌面走**标准 `instance/session.ts` 路由**,不经过 heal。
2. **分支错位**:即便在 httpapi,heal 也只在 **no-limit 分支**;前端 `fetchMessages`(`sync.tsx:302`)**始终带 limit** → 走分页分支。

→ 残骸 `completed=NULL` **从未被补盖**,侧边栏"运行中"的后端兜底等于不存在,只剩前端 `deriveSessionWorking` 硬扛(对末条残骸无解)。**这是同类"卡死/转圈"bug 反复发作的结构性根因 —— 补救机制接错代码路径。** 实证:对 prod sidecar 发无 limit 全量 GET,assistant 仍 `completed=NULL`(走标准路由无 heal);两条老残骸会话装新包后仍转、点击不愈。

## R4 复核报告(`packages/opencode/` 黑名单 override)

- **wrapper 不可行性**:heal 逻辑本就是 fork-only `heal-interrupted.ts`;缺的是在「桌面端读消息的上游路由」调用它。该路由 Hono 内联定义,无中间件能在带 session 上下文下补盖特定响应 → 只能上游注入(import 1 行 + 两分支各 1-2 行),正是 R1「fork-only 逻辑 + ≤5 行/点注入」。
- **风险评估**:heal **仅 session idle(无活跃 runner)时写** → 直播流式 status=busy、planHeal 空操作,零风险碰生成中;补 `completed=created` 不伪造时长;仅改 GET 读路径不碰 prompt/abort/write;幂等(补过即跳);分页仅首页补不碰历史页。
- **改动日志论证**:把 2026-06-06 错放的 heal 接到桌面 prod 标准路由实际命中的两分支,让那次修复**真正生效 + 落盘**。
- **验证**:heal-interrupted 单测 7 pass + 前端 13 pass + typecheck 16/16 + 真机 A/B(见下)。

## 自愈触发点

- 重连(SSE 心跳 15s 超时 / 断流 → `server.connected` → `queue.push` → `bootstrapInstance` → `bootstrapDirectory`)→ 重拉 status + reconcile,清残留。后端死亡是卡死主因,这条路径覆盖。
- 初次 bootstrap / 切目录 同样走对账,装新版后存量卡死会话重启即愈(旧版裸 merge 连重启都不愈)。
- 后端存活但单个 idle 事件丢失且不重连的极少数情况:点停止仍可恢复(后端存活,abort → cancel → 发 idle),且现在停止失败会弹错不再静默。

## 回归测试

- `session-status-reconcile.test.ts` 13 pass(reconcile 复现/根因守门 + `trailingOrphanIndex` + `healClearedSessionOrphans`)
- `heal-interrupted.test.ts` 7 pass(后端补盖逻辑)
- `bun run typecheck` 16/16

## 真机验证(2026-06-12,dev 测试包 pkill sidecar A/B)

- **主路径(崩溃→重连)双层自愈通过**:发消息→「思考中」→ `pkill -9 -f opencode-cli` → 看门狗重启 sidecar + 重连 → ① 主视图「思考中」+停止按钮消失(session_status 对账)② 侧边栏该会话转圈停止(末条残骸前端补盖)。自截图 + DB 双重确认。
- **侧边栏残骸层 — 机制根治(后端 heal 接对路由)决定性验证通过(2026-06-13 00:06)**:重建带 heal 的 sidecar(`SessionRoutes.messages.heal` 字符串实测在二进制内)→ 人为把一条 assistant 改残骸(`json_remove time.completed`)→ 走**桌面端真正用的分页首页 GET**(`/session/{id}/message?limit=50` 无 before):响应里 `assistant completed=<created>`(heal 补回)+ **DB 落盘** `completed=<created>`(持久化)。证明 heal 现在真正在桌面命中路径触发并落盘,残骸加载即补、不再 reopen 复发。(user 消息保持 NULL 正确,heal 只动 assistant 残骸。)
- **环境坑记录**:opencode **按 git 分支分库**(`~/.local/share/opencode/opencode-<branch>.db`),测试包跑在 `fix/stuck-working-recurrence` 分支 → 用独立空库,之前 `opencode.db` 里的残骸会话查不到("Session not found")—— 自测需对准 sidecar `lsof` 实际打开的那个分支库。dev 测试包每次启动弹 TCC 权限框需先 cliclick 清掉(见 memory)。
- **设计定论**:不能靠改 `deriveSessionWorking` 去 pending —— 其用例 7 故意把「末条残骸+无 status」判转圈以覆盖直播流式刚开始窗口,(messages,status) 区分不了"直播中/崩溃遗弃";正解是在确知 idle 时补盖**数据**(后端 heal 落盘 = 主;前端 reconcile 时 `healClearedSessionOrphans` 立即清 store = 即时兜底)。

## 回退方法

`git revert <merge>`;或单独删 `session-status-reconcile.{ts,test.ts}` + 还原 `bootstrap.ts:279` 与 `session.tsx` 的 `halt`(均带 FORK marker,易定位)。

## commit

| commit | 简述 |
|---|---|
| `e4a850c503` | `fix(session): 主视图永久「思考中」卡死 — session_status 对账清残留 busy + halt 停止吞错 [feat: stuck-working-status-reconcile] [bug-repro: 进程死/事件丢后前端 busy 永不回 idle]` |
