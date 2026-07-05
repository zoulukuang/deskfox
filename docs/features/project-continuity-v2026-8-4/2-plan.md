feat-id: project-continuity-v2026-8-4
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan 实施计划 + 决策轨迹

> 开发中实时追加 note(踩坑 / 方案推翻)。

## 实施顺序

1. **REQ-072**(落点最确定,先做):后端门控 → 前端 scope → tabs 去重 → 单测。
2. **REQ-071**(需 CDP 复现区分失效机制):build local 版复现 → 定位 → 定点修 → 冷启动不回归 → 回贡上游。
3. **REQ-070**(纯真机 QA,user 插 U 盘驱动):2a/2b → 回填 handoff。

## 决策轨迹

### D1(2026-07-05)· REQ-072 门控收敛到 session.ts 单文件

- 原计划(需求 doc)写「handler 加 global 降级判断」。实读发现 **handler 拿不到 resolve 后的 projectID**(`session.list` 内经 `InstanceState.context` 才 resolve `ctx.project.id`)。
- `InstanceContext`(`instance-context.ts`)自带 `directory` + `worktree` + `project.id`。→ 门控天然属 `session.ts` `list`:`input.scope==="project" && ctx.project.id===ProjectV2.ID.global` → 把 scope 降级为 undefined + 回填 `input.directory ?? ctx.directory` → 复用既有 `listByProject` 的 `scope!=="project"` directory 分支。
- **收益**:handler(`handlers/session.ts`)、`listByProject` 均不动,上游侵入从「2 文件」压到「1 文件 `session.ts`」,且 listByProject 的既有 scope 分支零改。
- handler 在 scope=project 时把 directory 置 undefined(#25215),故 global 分支必须回填 `ctx.directory`,否则退化大杂烩(TC-B4 专验)。

### D2(2026-07-05)· scope=project plumbing 确认上游原生

- blame:ListQuery.scope=#24853 / handler drop directory=#25215 / listByProject scope 分支=#30804,三者 `git merge-base --is-ancestor ... upstream/dev` 全 YES。
- → 前端 v2 SDK(`@opencode-ai/sdk/v2/client`)的 `session.list` query 已含 `scope?:"project"`(v2 gen:3451/7781),前端只需在调用点传 scope,**不改 SDK / 不改 handler / 不改 HTTP schema**。

### 进度锚(2026-07-05)

- REQ-072 代码+13 测试完成、typecheck 绿,已 commit feat 分支 `0b6daee2ec`(R4 squash 变体,带 override 标,未 push;改动日志.md + 3-changelog R4 复核报告齐)。
- 复用 today 08:12 `dist-deskfox/mac-arm64/DeskFox 本地版.app` 做 REQ-071 CDP(纯 renderer bug,重建 renderer 即可,`bun run build` + CDP reload)。
- REQ-071 下一步 = 插桩判 read-race vs reconcile-fail;REQ-070 = 待 user 插 U 盘。

### D3(2026-07-05 CDP 实测定案)· REQ-071 失效机制 = reconcile-fail,采候选②

- 静态分析:remount 后 `on(() => prompt.current())` 理论应随 makePersisted 异步水合重跑 reconcile;但实测失效。两假设:(a) read-race;(b) reconcile-fail。
- **CDP 实测定案 = (b) reconcile-fail**:采**候选②**(`on` 依赖纳入 `prompt.ready()()` 布尔,ready false→true 强制再 reconcile 一次)后,自动化测试**一击通过** —— 打开 A 键入草稿 → 切 B → 切回 A **草稿仍在**。证明 store 确实被异步水合成草稿(否则候选②靠 current 也灌不回),失效点纯在「reconcile 效应没在水合后重跑」。**排除 (a) read-race**(人类切项目耗时远大于异步写 flush,写早已落盘;且候选②若遇 read-race 会失败,实测通过反证)。
- **未采候选①**(gate 初始水合在 ready.promise 后):候选②更小侵入(只加依赖,不重构初始渲染),且实测已过,无需候选①。
- **回归**:冷启动读回 CDP 检查通过(`req071_coldstart_check.py`),候选②的新依赖不破坏冷启动路径。
- 修改点:`prompt-input.tsx:828` reconcile 效应,`() => prompt.current()` → `() => (prompt.ready()(), prompt.current())`,FORK marker。不动 keyed、不改持久化格式。**拟提 PR 回贡上游**(上游同 bug 至今未修)。
- 测试工具(fork-only,入 `packages/branding/smoke/`):`req071_draft_test.py`(切项目草稿保留)+ `req071_coldstart_check.py`(冷启动读回不回归)+ `req072_wiring_check.py`(侧栏 scope=project 实时抓包)。

## 风险 / 注意

- REQ-072 后端改 blacklist `session.ts` → R4:commit 标 `[override-blacklist]` + 3-changelog 出 wrapper 不可行论证 + 二次确认复核报告。走 R4 squash 变体(逐单元 commit 带 override 标,合 main 前 squash)。
- 放开 REQ-069 flag(D 拍板)= 触发 M8 存量 global 析出回归,按 v2026.6.25 灰度预案。非 git 四格验收在 flag 开前提测。
- tabs.tsx 去重去掉 `session.directory` 后 `base64Encode` 导入若变孤儿需一并删(避 lint)。
