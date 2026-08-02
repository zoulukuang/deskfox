feat-id: session-heal-stat-timeout
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-079 session 列表自愈 fs.stat 无超时(含原 REQ-076 并入)

## 需求

本仓/项目常驻外置 SSD(`/Volumes/ExtSSD`),离线卷(网络盘/拔掉的 U 盘)残留的会话目录让每次侧栏刷新被死路径拖住:`fs.stat` 对挂死卷可能阻塞几十秒,且每次 `Session.list` 都全量重扫。

## 根因(源码复查实锤)

- `packages/opencode/src/project/session-dir-heal.ts` `confirmedMissingByNodeFs` 裸 `fsp.stat` 无超时;
- `session.ts` `Session.list scope=project` 每次调用都跑 `healStaleSessionDirectories` 无闩;
- desktop 侧 fs-probe 已有 3s 竞速模式,但包边界隔离只能模式复用不能 import。

## 方案(定稿)

1. `confirmedMissingByNodeFs` 增可注入 `statFn`/`timeoutMs`(默认 `HEAL_STAT_TIMEOUT_MS=3000` 对齐 fs-probe),`Promise.race` 竞速;超时/非 ENOENT 均返回 false(保守不动,三态语义不变);定时器在 probe settle 时清除不泄漏。
2. 新增 `healStaleSessionDirectoriesOnce`(进程级闩):同 `projectID+worktree` 只扫一次,set-before-run 防同 tick 并发双跑;key 含 worktree → 改名自动重扫;`session.ts` 调用点换用(1 行);`project.fromDirectory` 主路径不走闩(带 oldWorktree 前缀重写语义,须每次跑)。
3. 导出 `resetSessionDirHealLatch` 供测试。

## 已知边界(spec 记录,先不做)

- 闩为进程生存期:离线卷重挂后同进程内不再自动重治,等重启/改名/fromDirectory(可选 TTL 5min,保持简单先不加);
- N 个离线目录首扫仍串行 N×3s(可选并发 stat 优化,后续有实感再做)。

## 测试用例(R8,动工前锁定)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| T1 | 注入永不 resolve 的 statFn → 限时返回 false | unit(bug-repro) | 不等挂死盘 |
| T2 | 三态语义不变:ENOENT→true / 其它错→false / 存在→false | unit | 回归 |
| T3 | 同 projectID+worktree 第二次调用零 stat;换 worktree 重扫;reset 重扫 | unit | 闩语义 |
| T4 | REQ-072 自愈/relocate 既有测试全绿 | unit(既有 6 测) | 回归 |

## 影响范围(R4 黑名单说明)

`packages/opencode/`(路径黑名单):`session-dir-heal.ts`(fork-only 文件,REQ-072 follow-up 建)+ `session.ts`(上游文件,改动 = 既有 FORK 调用点换函数名 1 行 + import 1 行)+ 既有测试文件追加。**commit 需 R4 override + user 审批**,复核报告见 3-changelog。
