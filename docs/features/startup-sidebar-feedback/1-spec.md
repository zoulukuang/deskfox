feat-id: startup-sidebar-feedback
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-092 启动期 sidebar 点击无响应

## 需求

冷启动后 backend bootstrap 完成前,点击 sidebar 项目 tile 无任何视觉反馈(SDK await 链挂起),新用户第一体感是「是不是卡死了」。

## 根因

`layout.tsx navigateToProject` 在导航前串行 await:`checkProjectAvailable`(fs 探测)→ `tryRelocate` → `worktree.list` → `session.get/list`(恢复上次会话)。bootstrap 未完成时 SDK 调用挂起 → 点击看似无效。sidebar 的 `SessionSkeleton` 门条件 `fetching() > 0 && count() === 0` 在 bootstrap 未启动查询时不亮。ready 信号已存在:`server-sync.tsx` `globalStore.ready = !bootstrap.isPending`。

前置消解:REQ-037 轻触误拖拽已随 Electron 换基座不复现 → 方向②(grip handle)失去动机,采方向①(只补反馈,不阻 click)。

## 方案(定稿,方向①)

1. `navigateToProject` 加 not-ready 快路径:bootstrap 未完成时跳过整条 SDK await 链,直接路由 `/${b64(root)}/session`(点击立即切页,目标页走 skeleton)。代价:not-ready 期点击不做「恢复上次会话」与 stale-relocate 探测(v1 接受;ready 后行为完全不变)。
2. skeleton 门条件抽纯函数 `showSessionSkeleton(fetching, count, ready)` = `count === 0 && (fetching > 0 || !ready)`,两处调用点(WorkspaceSection / 单 workspace 视图)统一换用。

## 测试用例(R8,动工前锁定)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| T1 | `showSessionSkeleton(0, 0, false)` | unit | true(启动期亮 skeleton) |
| T2 | `showSessionSkeleton(0, 0, true)` | unit | false(ready 且无查询不亮) |
| T3 | `showSessionSkeleton(1, 0, true)` | unit | true(拉取中原行为不变) |
| T4 | `showSessionSkeleton(*, >0, *)` | unit | false(有会话永不亮,防遮内容) |
| T5 | 冷启动立即点项目 tile → 路由立即切换 + skeleton 呈现 | CDP e2e(端到端阶段) | 点击即响应 |
| T6 | ready 后点 tile → 恢复上次会话行为不变 | CDP e2e / 真机 | 回归 |
| T7 | Mac 触摸板轻触+滑动无幻影 drag(REQ-037 回归,零触碰 sortable 代码) | 真机 QA | 验收门槛 |

## 影响范围

`layout.tsx`(上游文件,FORK marker)+ `sidebar-workspace.tsx`(上游文件,FORK marker)+ 新 fork-only 纯函数。
