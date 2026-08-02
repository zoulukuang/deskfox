feat-id: session-heal-stat-timeout
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 改动清单

| 文件 | 改动 |
|---|---|
| `packages/opencode/src/project/session-dir-heal.ts` | statFn/timeoutMs 注入 + 3s 竞速;新增 `healStaleSessionDirectoriesOnce` 闩 + `resetSessionDirHealLatch` |
| `packages/opencode/src/session/session.ts` | list 调用点换 `healStaleSessionDirectoriesOnce`(import + 调用行,均带 FORK marker) |
| `packages/opencode/test/project/project-session-dir-heal.test.ts` | 追加 T1-T3(3 测) |

## 决策轨迹

- 闩放 heal 模块内而非 session.ts 调用点:session.ts 是黑名单上游文件,把状态与逻辑收在 fork-only 文件里,session.ts 只换函数名 → 最小化黑名单侵入(R4 论证核心)。
- 闩语义用 set-before-run 布尔集合而非存 promise 句柄:Effect gen 首个 yield 前同步执行 has/set,同 tick 并发第二调用直接跳过,效果等价、实现更简;第二次 list 不等 heal 完成(heal 是后台修复,list 无需阻塞)。
- key 含 worktree:改名(新 worktree)天然重扫,覆盖「fromDirectory 后刷新」的实质诉求,免去跨模块 reset 调用。
- 超时返回 false 复用「检查出错保守不动」既有三态语义,零新分支。
- 测试撞 FK 约束(session.project_id → project)→ T3 先落 ProjectTable 行。
