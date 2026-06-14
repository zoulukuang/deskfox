feat-id: stuck-working-status-reconcile
status: done
related: ./3-changelog.md

# 上游架构迁移 — 合并交接说明(给 Windows 端)

> 给做上游大合并(`upstream/dev`,领先约 1907 commit)的同事。
> 这笔修复修的是**上游自己的潜伏 bug**(两个:① 前端 session_status 卡 busy ② 后端 heal-interrupted 接错路由),到上游最新 dev 都还在,所以**迁移后依然需要它**,但**不用重新开发**——只要确认下面 3 处注入点合并后保留成「我们的版本」即可。

## 一句话背景

「会话在不在运行」前端两个独立信号都会卡死:① 主视图「思考中」(`session_status` 卡 busy 没回 idle,对账用裸 setStore 清不掉)② 侧边栏永久转圈(末条 assistant 残骸 `completed=NULL`,而 2026-06-06 的后端 heal **接错了路由**对桌面端是死代码)。详见 [3-changelog.md](./3-changelog.md)。

## 改了哪几处(grep `stuck-working-status-reconcile` 可全定位)

| # | 文件 | 类型 | 合并影响 |
|---|---|---|---|
| 1 | `packages/app/src/context/global-sync/session-status-reconcile.ts` | **fork-only 新文件** | ✅ 不会冲突,自动带过去 |
| 2 | `packages/app/src/context/global-sync/session-status-reconcile.test.ts` | **fork-only 新文件** | ✅ 不会冲突 |
| 3 | `packages/app/src/context/global-sync/bootstrap.ts` | 注入(上游文件) | ⚠️ 需核对,见注入点 1 |
| 4 | `packages/app/src/pages/session.tsx` | 注入(上游文件) | ⚠️ 需核对,见注入点 2 |
| 5 | `packages/opencode/src/server/routes/instance/session.ts` | 注入(上游文件,**R4 黑名单**) | ⚠️ 需核对,见注入点 3;**改后需 sidecar rebuild** |

> 上游 `dev` 里对应行三处 bug 原样还在(`bootstrap.ts` 裸 setStore / `session.tsx` `.catch(()=>{})` / `instance/session.ts` 取消息无 heal)——合并很可能覆盖回 bug 版,务必核对。

## 注入点 1:bootstrap.ts —— session.status() 对账(只 1 行)

**顶部加 import:**
```ts
import { applyReconciledSessionStatus } from "./session-status-reconcile"
```

**上游 bug 版(合并后若看到这行 = 被覆盖了,要改回去):**
```ts
() => retry(() => input.sdk.session.status().then((x) => input.setStore("session_status", x.data!))),
```

**应保留成我们的版本(reconcile 逻辑全在 fork-only helper 里,这里只 1 行调用):**
```ts
      // FORK: 对账改用 applyReconciledSessionStatus(reconcile 整体替换)清掉进程死/事件丢/sidecar
      // 重启后残留的 busy;裸 setStore 是 merge 清不掉 → 主视图永久「思考中」卡死。[feat: stuck-working-status-reconcile]
      () => retry(() => input.sdk.session.status().then((x) => applyReconciledSessionStatus(input.store, input.setStore, x.data))),
```
> 把判定 + reconcile 写回都收进 `session-status-reconcile.ts`(fork-only),上游注入面只剩 1 行,合并冲突面最小。

## 注入点 2:session.tsx —— 停止按钮 halt 不再吞错

**上游 bug 版(合并后若看到 = 要改回去):**
```ts
  const halt = (sessionID: string) =>
    busy(sessionID) ? sdk.client.session.abort({ sessionID }).catch(() => {}) : Promise.resolve()
```

**应保留成我们的版本:**
```ts
  // FORK: 停止失败不再静默吞错(原 .catch(()=>{})),弹真实提示;残留 busy 由 session.status()
  // 对账自愈,见 global-sync/session-status-reconcile.ts [feat: stuck-working-status-reconcile]
  const halt = async (sessionID: string) => {
    if (!busy(sessionID)) return
    try {
      await sdk.client.session.abort({ sessionID })
    } catch (err) {
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(err, language.t),
      })
    }
  }
```
> 依赖 `showToast` / `language` / `formatServerError`,session.tsx 里本就都 import 了。

## 注入点 3:instance/session.ts —— 后端 heal 接到桌面端真正命中的路由(R4 黑名单)

> **机制**:`heal-interrupted` 原仅挂 HTTPAPI handler,但桌面锁 prod channel 走标准 `instance/session.ts` 路由(HTTPAPI 仅 dev/beta/local 默认开)+ 前端始终带 limit 走分页分支 → 2026-06-06 的 heal 对桌面端**双重死代码**,残骸永不补盖、侧边栏永久转。

**顶部加 import:** `import { HealInterrupted } from "@/session/heal-interrupted"`

GET `/:sessionID/message` handler **两分支都要保留 heal**:

① no-limit 分支(`query.limit === undefined || === 0`):`session.messages()` 结果包一层
```ts
              const msgs = yield* session.messages({ sessionID })
              return yield* HealInterrupted.healInterrupted({ sessionID, messages: msgs })  // FORK
```
② 分页分支(`const page = await MessageV2.page(...)` 之后):首页补盖
```ts
        // FORK: 首页(before 未设)= 最近消息含末条,idle 补盖残骸 + 落 DB,修侧边栏永久转
        if (query.before === undefined) {
          page.items = await runRequest(
            "SessionRoutes.messages.heal", c,
            HealInterrupted.healInterrupted({ sessionID, messages: page.items }),
          )
        }
```
> ⚠️ R4 黑名单文件:commit 要 `--no-verify` + `[override-blacklist: ...]` + 记 `改动日志.md`(理由:heal 逻辑本 fork-only,须在上游 Hono 路由注入才生效,无中间件可 wrapper)。
> ⚠️ 改后必须 **sidecar rebuild**(build-deskfox 时间戳判断自动触发)。

## 最省事的做法:cherry-pick 整组

迁移走 rebase / 重新挑 fork commit:cherry-pick `main..fix/stuck-working-recurrence` 这组 7 个 commit(grep `[feat: stuck-working-status-reconcile]` 反查),新文件自动带、3 处注入自动 apply。核心:`e4a850c503`(主视图对账+halt)+ `a28c070b0f`(残骸前端补盖)+ `e5dbefe376`(**后端 heal 接对路由,R4**)。

## 合并后验证

```bash
# 1. 三处注入都在 + 没被覆盖回 bug 版
grep -rn "reconcileSessionStatus\|HealInterrupted" packages/app/src packages/opencode/src/server/routes/instance/session.ts
grep -n 'setStore("session_status", x.data!)' packages/app/src/context/global-sync/bootstrap.ts   # 应为空
grep -n '.catch(() => {})' packages/app/src/pages/session.tsx                                      # halt 那行应为空
grep -c "SessionRoutes.messages.heal" packages/opencode/src/server/routes/instance/session.ts     # 应为 1

# 2. 测试 + 类型(改 packages/opencode 后打包会自动重建 sidecar)
cd packages/app && bun test src/context/global-sync/session-status-reconcile.test.ts   # 13 pass
cd packages/opencode && bun test test/session/heal-interrupted.test.ts                 # 7 pass
bun run typecheck                                                                       # 全绿
# 3. 后端 heal 决定性验证法见 3-changelog.md「决定性验证」段(造残骸→分页首页 GET→看补回+落 DB)
```

## 可选:上游 PR

这是上游自己的 bug。若有精力可把本修复提 PR 给 anomalyco/opencode,合入后以后迁移彻底不用管这块(降漂移)。
