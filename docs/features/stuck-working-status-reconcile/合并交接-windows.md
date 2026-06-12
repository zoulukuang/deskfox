feat-id: stuck-working-status-reconcile
status: done
related: ./3-changelog.md

# 上游架构迁移 — 合并交接说明(给 Windows 端)

> 给做上游大合并(`upstream/dev`,领先约 1907 commit)的同事。
> 这笔修复(commit `e4a850c503`)修的是**上游自己的潜伏 bug**,到上游最新 dev 都还在,所以**迁移后依然需要它**,但**不用重新开发**——只要确认下面 2 处注入点合并后保留成「我们的版本」即可。

## 一句话背景

主视图永久卡「思考中」+ 停止按钮关不掉。根因:前端 `session_status` 卡 busy 没回 idle,而唯一对账点用裸 `setStore`(merge)清不掉残留 busy。详见 [3-changelog.md](./3-changelog.md)。

## 改了哪 3 处(grep `stuck-working-status-reconcile` 可全定位)

| # | 文件 | 类型 | 合并影响 |
|---|---|---|---|
| 1 | `packages/app/src/context/global-sync/session-status-reconcile.ts` | **fork-only 新文件** | ✅ 不会冲突,自动带过去 |
| 2 | `packages/app/src/context/global-sync/session-status-reconcile.test.ts` | **fork-only 新文件** | ✅ 不会冲突 |
| 3 | `packages/app/src/context/global-sync/bootstrap.ts` | 注入(上游文件) | ⚠️ 需核对,见下 |
| 4 | `packages/app/src/pages/session.tsx` | 注入(上游文件) | ⚠️ 需核对,见下 |

> 上游 `dev` 里对应行:`bootstrap.ts` 的 session_status 同步(裸 setStore)+ `session.tsx` 的 `const halt`(`.catch(()=>{})`)——**两处 bug 原样还在**,所以合并很可能把我们的改动覆盖回 bug 版,务必核对。

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

## 最省事的做法:cherry-pick

如果迁移走 rebase / 重新挑 fork commit,直接:
```bash
git cherry-pick e4a850c503        # fix 本体(含新文件 + 2 注入 + changelog)
# d3dc994506 是回填 hash 的 docs commit,可选
```
新文件自动带过去,2 处注入自动 apply;若 `bootstrap.ts` / `session.tsx` 周边漂移大导致冲突,按上面「应保留版本」解决即可。

## 合并后验证

```bash
# 1. 三处都在 + 没被覆盖回 bug 版
grep -rn "stuck-working-status-reconcile\|reconcileSessionStatus" packages/app/src
grep -n 'setStore("session_status", x.data!)' packages/app/src/context/global-sync/bootstrap.ts   # 应为空
grep -n '.catch(() => {})' packages/app/src/pages/session.tsx                                      # halt 那行应为空

# 2. 测试 + 类型
cd packages/app && bun test src/context/global-sync/session-status-reconcile.test.ts   # 6 pass
bun run typecheck                                                                       # 全绿
```

## 可选:上游 PR

这是上游自己的 bug。若有精力可把本修复提 PR 给 anomalyco/opencode,合入后以后迁移彻底不用管这块(降漂移)。
