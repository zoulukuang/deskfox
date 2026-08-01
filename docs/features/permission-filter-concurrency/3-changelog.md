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
