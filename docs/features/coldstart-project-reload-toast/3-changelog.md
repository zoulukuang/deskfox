---
feat-id: coldstart-project-reload-toast
status: done
related: ./3-changelog.md
---

# 3-changelog — coldstart-project-reload-toast

> Small 规模(helper 扩展 + 2 toast 站点 guard + 单测),按规范只写 3-changelog.md。
> 接力 [coldstart-toast-race](../coldstart-toast-race/)(同根:冷启动瞬时态弹冗余红 toast),
> 补它未覆盖的 `bootstrapDirectory` 重载路径 + tanstack-query `Missing queryFn` 这类新瞬时产物。
> 本分支另搭车一笔独立 Tiny UI fix(toast 起始位置上抬),见文末「搭车」节。

## 背景 / 现象

启动 DeskFox 自动重载上次打开的项目(如 OPENCODE-PLAN)时,屏幕弹两条红 toast:
**「无法重新加载 <项目>」**,描述分别是:
1. providers 查询抛 tanstack-query 的 `Missing queryFn: '["…","providers"]'`
2. agent 查询抛 `error sending request for url (http://127.0.0.1:53890/agent)`(连接级不可达)

## 根因

`bootstrapDirectory`(`global-sync/bootstrap.ts`)在 sidecar 后端 ready 前抢跑重载逻辑:

- **providers**:sdk 未 ready 时 query 的 `queryFn` 退化为 `skipToken`,`fetchQuery` 直接抛 `Missing queryFn` —— tanstack-query 对 skipToken 查询主动 fetch 的固有行为。
- **agent**(及其它 slow 任务):后端进程还没起来,Tauri/reqwest 层连接级不可达,抛 `error sending request`。

两者都是 **transient**:sdk / 后端 ready 后 bootstrap 重跑即恢复,不该弹红 toast。
[coldstart-toast-race](../coldstart-toast-race/) 已为「连接级不可达」建了 `isBackendUnreachableError` 并在 3 个渲染态 toast 站点静默,但**没覆盖 `bootstrapDirectory` 这条重载路径**,也没识别 `Missing queryFn` 这类 sdk-未-ready 的瞬时产物。

## 修法

| 文件 | 改动 |
|---|---|
| `packages/app/src/utils/server-errors.ts` | 新增纯函数 `isTransientStartupError(error)` — 复用 `isBackendUnreachableError`(连接级不可达)+ 额外正则识别 tanstack `Missing queryFn`(`/missing queryfn/i`);吃 `Error`/`string`,空/非错误输入安全返回 `false` |
| `packages/app/src/context/global-sync/bootstrap.ts` | 两处 guard(均加 FORK marker):① providers reload 的 `.catch` —— transient 则 `console.error` 后 `return` 不弹;② slow 任务汇总处 —— 用 `slowErrs.find(e => !isTransientStartupError(e))` 取**真错**,只有含真错才弹 toast(且 toast 描述用真错而非 `slowErrs[0]`) |
| `packages/app/src/utils/server-errors.test.ts` | +4 组单测:继承连接级不可达 / 识别 `Missing queryFn` 大小写变体 / 真错(500/Unauthorized/无关)不误判 / 空输入安全 |

## 设计取舍

- **复用而非另起**:`isTransientStartupError` 包住 `isBackendUnreachableError` 再加一类,语义是「冷启动瞬时态(更广)」⊇「连接级不可达」,连接级恢复 UX 仍交看门狗统管,只是 bootstrap 路径多识别一类 sdk-未-ready 产物。
- **「含真错才弹」而非「全 transient 才静默」**:slow 汇总处用 `find(真错)`,确保混入的**真**故障仍 surface(描述也换成真错),不会因为列表里有一条 transient 就整体吞掉。
- **只 suppress 不扩重载 wiring**:恢复靠既有 `bootstrap.refetch` / 健康轮询自愈,沿用 coldstart-toast-race 的取舍,避免过度工程。

## 验证

- `isTransientStartupError` 4 组新单测 + 文件原测 = **server-errors 19 pass / 0 fail**。
- app 包全量 **830 pass / 0 fail**(0 回归)。
- monorepo typecheck **16/16**。
- ⚠️ 端到端「重载窗口 toast 静默」依赖 sidecar 冷启动竞态真触发(intermittent),未进自动化;helper 单测覆盖实测错误字符串识别,集成为简单 `if(...) return` / `find` 前置守卫。

## 规模 / 影响

- **Small**:3 文件(1 helper 扩展 + 1 context + 1 test),净 ~50 行,全 fork-only(server-errors.ts 为 fork helper;bootstrap.ts 两处加 FORK marker)。
- **回退**:`git revert` 本 commit;恢复后仅「重载窗口重新弹冗余 toast」,无功能影响。
- **0 改上游产品代码 / 0 R4 override / 0 黑名单**。
- [bug-repro: 冷启动重载上次项目时 providers/agent 查询在后端 ready 前抢跑,各弹冗余「无法重新加载」红 toast — transient 应静默]

---

## 搭车:toast 起始位置上抬(独立 Tiny UI fix)

> 同分支顺手修的一笔独立 UI 小改,与上文 transient 逻辑无关,**单独成一笔 commit**。

- **现象**:右下角 toast 与聊天输入框右下角的提交/执行按钮竖直区间重叠,常盖住按钮。
- **修法**:`packages/app/src/index.css` 把 toast region `bottom: 48px`(上游 toast.css 默认)上抬到 `112px`,清过 composer 提交按钮(user 实测 96px 已不盖,再留余量)。走 index.css override 不改上游 `packages/ui` toast.css。
- **规模**:Tiny,4 行 CSS / 0 改上游 / [fix: toast-above-composer-submit]。
