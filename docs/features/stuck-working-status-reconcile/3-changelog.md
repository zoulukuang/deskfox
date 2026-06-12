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

## 自愈触发点

- 重连(SSE 心跳 15s 超时 / 断流 → `server.connected` → `queue.push` → `bootstrapInstance` → `bootstrapDirectory`)→ 重拉 status + reconcile,清残留。后端死亡是卡死主因,这条路径覆盖。
- 初次 bootstrap / 切目录 同样走对账,装新版后存量卡死会话重启即愈(旧版裸 merge 连重启都不愈)。
- 后端存活但单个 idle 事件丢失且不重连的极少数情况:点停止仍可恢复(后端存活,abort → cancel → 发 idle),且现在停止失败会弹错不再静默。

## 回归测试

- 新增 `session-status-reconcile.test.ts` 7 pass(含复现 + 根因守门)
- `bun test src/context/global-sync/` 40 pass / 0 fail
- `packages/app` 全量 `bun test` 845 pass / 0 fail
- `bun run typecheck` 16/16

## 回退方法

`git revert <merge>`;或单独删 `session-status-reconcile.{ts,test.ts}` + 还原 `bootstrap.ts:279` 与 `session.tsx` 的 `halt`(均带 FORK marker,易定位)。

## commit

| commit | 简述 |
|---|---|
| `e4a850c503` | `fix(session): 主视图永久「思考中」卡死 — session_status 对账清残留 busy + halt 停止吞错 [feat: stuck-working-status-reconcile] [bug-repro: 进程死/事件丢后前端 busy 永不回 idle]` |
