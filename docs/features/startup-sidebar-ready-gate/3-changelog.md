---
feat-id: startup-sidebar-ready-gate
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 3-changelog — 启动期 sidebar ready gate

## 摘要

修冷启动期"sidebar 项目图标点不动十几秒"的 UX 问题(P0 急迫,user 反馈过 + CDP 测试自己撞过 2 次)。**顺手修**了一个发现的 `globalSync.ready` 语义反了的 bug(getter 字段名 "ready" 但实际返回 isPending,callsite 也跟着反,双反看似工作但读者每次理解都要在脑里翻一次,极易写错下一个 callsite)。

## 改动

**新建**:
- `packages/app/src/pages/layout/ready-gate.ts`(35 行)— 2 个纯函数 helper
- `packages/app/src/pages/layout/ready-gate.test.ts`(40 行 / 7 case)— Logic 清单覆盖
- `docs/features/startup-sidebar-ready-gate/1-spec.md` / `2-plan.md` / `3-changelog.md`(本文)

**修改**(纯 fork 文件,FORK marker 全标):
- `packages/app/src/context/global-sync.tsx`(2 行净改)— `ready` getter 修正:`return !bootstrap.isPending`
- `packages/app/src/pages/layout/sidebar-project.tsx`(~15 行)— ProjectTile 加 `bootReady` prop + classList opacity-60/cursor-wait + onClick 跳过 + aria-busy;SortableProject 读 `useGlobalSync().ready` 传 bootReady

**Total**:~100 行(代码 ~55 + 测试 40 + 文档 ~50 各文档)= **Medium feat**

## 验证

- ✅ `bun test ready-gate.test.ts`:7/7 pass(4 状态组合 × 2 函数,加 sanity)
- ✅ `bun run typecheck`:整仓 17/17 pass
- ✅ release build DeskFox.exe 启动正常,CDP 验证 12 个 tile 全部 `aria-busy` 属性正确渲染(wiring OK)
- ⚠️ Gate 视觉态窗口在本机非常短(冷启动 ~3s 内完成 bootstrap),没现场抓到"灰态"截图;helper 单测 + wiring 验证 + 慢机器场景理论覆盖

## 关键回归点

| 项 | 测试位置 |
|---|---|
| 已选 tile 启动期 toggle sidebar 仍工作 | `ready-gate.test.ts:shouldGateProjectTile bootReady=false+selected=true → false` |
| 未选 tile 启动期 click 不调 navigateToProject | `ready-gate.test.ts:shouldSkipProjectNavigate bootReady=false+selected=false → true` |
| 就绪后 click 正常 | `ready-gate.test.ts:bootReady=true` 三个 case |
| `globalSync.ready` 语义对齐字段名 | `global-sync.tsx:84` 注释解释原 inverted → 修正 |
| home.tsx loading display 时机正确(顺手修) | 行为变化:加载中显示 loading 文案,完成显示 list/empty(原行为反了)|

## 影响

- **用户视角**:冷启动期点项目图标变灰 + 鼠标 wait,明确"启动中,稍候",而非"点了没反应"
- **慢机器**:bootstrap 期更长时,gate 更显著生效
- **child bootstrap**:切到没 bootstrap 过的 project 时,同 gate 机制生效(本 feat 用同一个 `globalSync.ready` 信号)
- **0 改上游**:全部改动落在 fork-only 文件 / 全部加 FORK marker
- **0 R4**:没碰黑名单

## 回退

```bash
git revert <merge-commit>  # 一笔 revert 整 feat
# 或单独 revert global-sync ready 语义那笔(影响 home.tsx loading 行为)
```

## 关联

- backlog 源 [[OPENCODE-PLAN/需求池/启动期-sidebar-点击无响应]] — 本 feat 完成后该 backlog 可清(已 done)
- `media-gen-xiaomi` feat CDP 测试时撞同样问题(reload 25s 才 ready)反向验证 backlog 真实
- knowledge-base [[OPENCODE-PLAN/knowledge-base/接 AI 媒体供应商-踩坑实录]] §24 "真桌面 QA 反馈循环" 同款经验
