feat-id: startup-sidebar-feedback
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动记录

## commit

- (本笔 commit)`feat(app): REQ-092 启动期 sidebar 点击即响应 + skeleton 门补 ready [feat: startup-sidebar-feedback]`(分支 feat/daily-ux-batch)

## 实际改动

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/app/src/pages/layout/session-skeleton-gate.ts` | +11(新) | skeleton 门纯函数 |
| `packages/app/src/pages/layout/session-skeleton-gate.test.ts` | +25(新) | T1-T4 |
| `packages/app/src/pages/layout/sidebar-workspace.tsx` | ±6 | 两处门条件换用纯函数(FORK marker ×2 + import) |
| `packages/app/src/pages/layout.tsx` | +11 | navigateToProject not-ready 快路径(FORK-BEGIN/END) |

## 影响范围

- 上游文件 2(layout.tsx / sidebar-workspace.tsx,均已有 FORK 侵入史,非黑名单);fork-only 新文件 2。0 R4。
- 行为变化:① bootstrap 未完成时点项目 tile 立即路由到会话列表页(不再挂起等 SDK);② 启动期 sidebar 会话区亮 skeleton。
- 已知代价(spec 记录):not-ready 窗口内点击不做「恢复上次会话」与 stale-relocate,ready 后行为不变。

## 回归测试

- 单测 4 pass(T1-T4);app typecheck 绿。
- T5(冷启动 CDP 点击即响应)/ T6(ready 后恢复会话回归)在本批端到端阶段跑;T7(REQ-037 轻触回归)真机 QA 随发版。

## 回退方法

单 commit `git revert`,无状态迁移。
