feat-id: startup-sidebar-feedback
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 改动清单

| 文件 | 改动 |
|---|---|
| `packages/app/src/pages/layout/session-skeleton-gate.ts` | 新增 fork-only:`showSessionSkeleton(fetching, count, ready)` |
| `packages/app/src/pages/layout/session-skeleton-gate.test.ts` | 新增:T1-T4 |
| `packages/app/src/pages/layout/sidebar-workspace.tsx` | 两处 `loading` 门条件换用纯函数(FORK marker) |
| `packages/app/src/pages/layout.tsx` | `navigateToProject` not-ready 快路径(FORK-BEGIN/END) |

## 决策轨迹

- ready 信号复用 `serverSync.ready`(getter,`!bootstrap.isPending`),不新增状态。
- 快路径放在函数最顶(连 `checkProjectAvailable` 都跳):它虽是 Electron IPC 不走 sidecar,但后续 `tryRelocate` / `worktree.list` 都要 SDK,拆一半没意义;not-ready 窗口内 stale 项目点击会进死目录会话列表页,ready 后再点自动走 relocate(spec 已记 v1 接受)。
- 可选的 ProjectTile pulse 不做(YAGNI,skeleton + 立即切页已给足反馈)。
- 施工前实测 Electron 冷启动窗口时长的「未决」项:改为在端到端阶段用 CDP 实测覆盖(T5),不再作为降级开关。
