feat-id: permission-filter-concurrency
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动记录

## commit

- `3894243dfa` fix(app): REQ-078 权限过滤签名 refetch + canResolve 下沉共享层 [feat: permission-filter-concurrency]

## 实际改动

| 文件 | 类型 | 内容 |
|---|---|---|
| `packages/app/src/context/permission-resolvable.ts` | fork-only 新增 | candidateSignature + createResolvableCache 纯逻辑 |
| `packages/app/src/context/permission.tsx` | 上游+FORK | resolvable 共享层(lazy per-directory effect)+ canResolve 暴露 |
| `packages/app/src/pages/session/composer/session-composer-state.ts` | 上游+FORK | 删布尔 source 私有 resource(bug 根源),过滤改 canResolve |
| `packages/app/src/pages/layout/sidebar-items.tsx` | 上游+FORK | 项目徽标 + session 徽标 include 加 canResolve(消幻影徽标) |
| `packages/app/src/pages/layout/project-avatar-state.ts` | 上游+FORK | 同上 |
| `packages/app/src/context/permission-resolvable.test.ts` | fork-only 测试 | 5 用例(签名稳定性 / A→A+B 复现 / 空签名 gate / fail-open / 乱序丢弃) |

## 回归测试

- app bun test 533 pass / 2 fail(project-restore ×2,main 预存,与本改动无关);typecheck 0 错;
- permission-resolvable.test.ts 5/5(含 [bug-repro] 主线用例)。

## 影响范围与回退

- 影响:composer 权限卡过滤时序(签名变更即 refetch,并发权限不再藏死);侧栏/头像权限徽标
  开始应用跨-instance 过滤(飞书触发的权限不再亮幻影灯);无候选权限时零网络请求(gate 保留)。
- 回退:整笔 `git revert`。

## 遗留 / follow-up

- 真并发双权限真机行为(飞书无人值守流)抽查待真机;
- e2e(timeline/smoke 无网络错)在批次端到端记录中。

---

## follow-up:REQ-112 候选源失效复现(2026-08-15)

- `d10a91e161` test(app): REQ-112 权限过滤层候选源失效回归复现 + child store 直读验收闸

2026-08 上游同步(1.17.4→1.18.16)把 permission 的权威源挪到全局 session store,本 feat 的
候选源 `sync.child(dir)[0].permission` 恒空 ⇒ 签名恒空 ⇒ cache 恒 skip ⇒ `canResolve` 恒 true,
过滤层整体 **fail-open**(与 REQ-078 原 bug 的 fail-closed 挂死方向相反)。该 commit **只落复现
与检测,不含修复**(修复见 PLAN 仓 REQ-112 / 计划 2026-08-14-2 的 S6):

| 文件 | 类型 | 内容 |
|---|---|---|
| `packages/app/src/context/permission-resolvable-source.test.ts` | fork-only 测试 | 4 用例钉死上述链条,含「不传 sessionContent 时事件正常写入」对照组 |
| `packages/app/scripts/check-child-store-reads.sh` | fork-only 验收闸 | 扫 `sync.child(...)` 返回值上的 sessionFields 直读;字段清单实时解析 `directory-sync.ts`,上游增删自动跟随;bash 3.2 兼容 |

## follow-up:复现用例 typecheck 修复(2026-08-17)

上一笔的 `permission-resolvable-source.test.ts` **typecheck 是红的**,`bun run typecheck` 报
`(150,29) error TS2769: Argument of type 'never[]' is not assignable to parameter of type 'undefined'`。
成因是 `let applied: string[] | null | undefined = undefined` + 回调内赋值:TS 控制流分析看不见
回调里的写入,把 `applied` 收窄成 `undefined`,`toEqual([])` 的重载随之匹配不上。**运行时一直是
绿的(4 pass),只有类型层报错**,所以 commit 当时没被拦下 —— typecheck 闸挂在 `pre-push`,而这
笔从 8-15 起一直未 push,闸没有机会响。后果:在修掉之前 `main` 的任何 push(含发版)都会被挡。

| 文件 | 类型 | 内容 |
|---|---|---|
| `packages/app/src/context/permission-resolvable-source.test.ts` | fork-only 测试 | 两处 `let applied` 捕获改为 `const appliedCalls: (string[] \| null)[] = []` 数组收集,读取走 `appliedCalls[0]`(数组元素类型不受回调收窄影响);顺带把「apply 是否被调用」由隐含断言升级为显式 `toHaveLength(0/1)` |

第 3 条用例原本侥幸绿,只因 `toBeUndefined()` 不接收参数、绕开了重载匹配 —— 同一个陷阱潜伏着,
故两处一并改成同一套写法,不留半套。

- 回归:app `bun run test` **1012 + 41 browser 全绿**;`bun turbo typecheck --filter='!./packages/console/*'`(= pre-push 同款闸)**29/29 successful**。
- 回退:`git revert` 本笔即可,不影响 `d10a91e161` 的复现资产。
