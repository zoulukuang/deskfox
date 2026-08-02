feat-id: permission-filter-concurrency
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 步骤

1. fork-only `permission-resolvable.ts`(纯逻辑)+ 5 单测;
2. `permission.tsx`:resolvable store + `ensureResolvableTracked(directory)`(lazy 建 effect,
   `runWithOwner` 挂 context owner)+ `canResolve` 暴露;
3. composer:删布尔 source resource,过滤改 `permission.canResolve`;
4. sidebar-items ×2 / project-avatar-state:include 回调追加 canResolve。

## 决策轨迹

- **lazy 追踪而非全目录预建**:`canResolve` 首次被某 directory 调用才建 effect;而 include 回调只在
  该目录确有 pending 权限时才被 sessionPermissionRequest 调用 → 无权限时零开销、零网络请求,
  与旧 gate(hasCandidate)语义等价但覆盖所有消费方。
- **fail-open 语义原样保留**:undefined(未拉到)/null(失败)都不过滤;宁可多展示(点了 404 有
  既有优雅降级)不误藏(藏 = turn 挂死,本 bug 根源)。
- **乱序竞态**:cache.sync 完成时校验签名仍是自己才 apply(单测覆盖);旧实现无此保护。
- **serverSDK.client.permission.list({ directory })** 服务器级 SDK 带目录参数(enableDirectory 等
  已有用例背书),侧栏跨项目场景无需逐目录建 SDK client。
