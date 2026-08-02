feat-id: session-heal-stat-timeout
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动记录

## commit

- `b407b3fb60` `fix(opencode): REQ-079 heal stat 3s 竞速 + Session.list 进程级闩 [feat: session-heal-stat-timeout] [bug-repro: …] [override-blacklist: …;user 2026-08-02 审批]`(分支 feat/daily-ux-batch;R4 复核报告见下,user 于 commit 前审批通过)

## 实际改动

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/opencode/src/project/session-dir-heal.ts` | +45 | 竞速 + 闩(fork-only 文件) |
| `packages/opencode/src/session/session.ts` | ±4 | 调用点换闩变体(import 1 行 + 调用 1 行 + FORK 注释 2 行) |
| `packages/opencode/test/project/project-session-dir-heal.test.ts` | +75 | T1-T3 |

## R4 复核报告(single-person 场景,commit 前供 user 审)

1. **wrapper 不可行性**:崩点在 opencode 核心内部 —— `confirmedMissingByNodeFs` 与 `Session.list` 的 heal 调用点都在 `packages/opencode/` 进程内,外部(desktop/app)无注入点;heal 逻辑本就住在 fork-only 的 `session-dir-heal.ts`(REQ-072 follow-up 所建,因路径黑名单整目录覆盖被误伤,同 REQ-048 记录的已知误伤模式)。真正的上游文件只有 `session.ts`,改动被压缩到「已有 FORK 调用点换函数名」1 行 + import 1 行。
2. **风险评估**:低。三态判定语义零变化(超时并入既有「检查出错→false 保守不动」分支);闩只影响 fork 自有的 heal 兜底路径,上游原生行为(fromDirectory 主路径)不走闩;9/9 测试绿(3 新 + 6 既有 REQ-072 回归)+ opencode typecheck 绿;单 commit 可整体 revert。
3. **改动日志论证**:本条目 + `改动日志.md` 行(commit 时同步登记)。

## 影响范围

- 行为变化:① 死路径 stat 3s 封顶;② 同 projectID+worktree 每进程只扫一次(改名重扫)。
- 已知边界:离线卷重挂后同进程不再自动重治(重启/改名恢复);首扫串行 N×3s(见 spec)。

## 回归测试

- `project-session-dir-heal.test.ts` 9 pass(3 新 + 6 既有);opencode typecheck 绿;project 簇全量回归见批次端到端报告。

## 回退方法

单 commit `git revert`(session.ts 调用点随 revert 回到无闩版本,无数据迁移)。
