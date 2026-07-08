feat-id: project-close-heal-race
status: done
related: ./3-changelog.md(Tiny,1-spec / 2-plan 省略)

# 右键项目「关闭」失效 — REQ-072 自愈效应误补回(Tiny bug fix)

## 现象

侧栏项目图标右键 →「关闭」点了没反应,项目关不掉。Windows / macOS 都复现(纯 renderer 逻辑)。
2026.8.3/8.4 用户报障,回归自 2026-07-05 `e4d815eb5`(REQ-072 复制项目独立展示)。

## 根因

`layout.tsx` 里 REQ-072 加的"折叠竞态自愈"效应同时把 `projects.list()` 当依赖追踪:

1. 用户点「关闭」当前项目 → `closeProject` 把项目从列表移除(list 变化 → 效应立刻重跑);
2. 此刻路由还没切走(solid-router 导航在 transition 里异步生效),`currentDir` 仍指向刚关闭的目录;
3. 效应发现"当前路由目录不在列表里 + 实例已 boot(worktree === 目录)"→ 误判为被 reconciler
   误折叠 → `projects.open()` 又加回来 → 表现为「关闭」无效。

关闭非当前项目不受影响(currentDir 指向的项目还在列表)→ 主要炸当前项目 + 关最后一个项目两条路径。

## 修法

自愈效应只该由「路由进入该目录」或「实例 boot 完成」驱动,列表本身的增删不是触发信号 →
`isListed` 检查包 `untrack()`。原 REQ-072 折叠竞态场景(boot 完成时 `child.path.worktree`
信号变化触发)不受影响,回归测试覆盖。

顺手把效应逻辑从 `layout.tsx` 抽到 fork-only 新文件(helper extract,可单测)。

## 改动清单

| 文件 | 改动 |
|---|---|
| `packages/app/src/pages/layout/project-restore.ts` | **新增** — 自愈效应抽出 + untrack 修复(fork-only) |
| `packages/app/src/pages/layout/project-restore.test.ts` | **新增** — 6 条单测:3 条 bug 复现(关当前/关后切路由/关最后一个不补回)+ 3 条回归(REQ-072 折叠竞态仍自愈/路由进入未列出目录补回/已在列表不重复 open) |
| `packages/app/src/pages/layout.tsx` | 原 inline 效应替换为 `createProjectRestoreEffect(...)` 调用(FORK 注释更新) |
| `packages/app/package.json` | `test:unit` / `test:unit:watch` 加 `--conditions=browser` — bun test 默认把 solid-js 解析到 server 构建(`createEffect` 是 no-op),effect 类单测跑不起来;browser 条件下全量 521 测试跑过全绿 |

commit:(见本分支,合 main 后回填 hash)

## 测试

- 单测:`bun test --conditions=browser src/pages/layout/project-restore.test.ts` 6/6 绿;
  变异验证:去掉 `untrack` 恢复旧行为 → 3 条复现测试如预期变红。
- 全量:packages/app 521 测试 browser 条件下全绿;`bun run typecheck` 26/26 过。
- 真机(Win,local 档 + CDP 9222 真实右键/点击,2026-07-08):**三条路径全 PASS** —
  关闭当前项目(两轮)/ 关闭非当前项目 / 关闭最后一个项目(回首页,截图确认),
  均为"立即消失 + 3 秒后未被自愈效应补回"。Mac 端同一 renderer 逻辑,预期同修(视觉可真桌面抽查)。

## 回退

revert 本 commit 即可;回退后 REQ-072 自愈行为回到旧版(连带右键关闭 bug 复活)。
