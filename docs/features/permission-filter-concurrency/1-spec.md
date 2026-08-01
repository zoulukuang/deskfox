feat-id: permission-filter-concurrency
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-078 方案D 权限过滤并发挂死 + 过滤下沉共享层

> 来源:OPENCODE-PLAN 需求计划/2026-08-02.md + 需求池/飞书桥接/权限过滤并发挂死.md(2026-07-08 发版前 code-review 收敛)。

## 问题(真 bug)

`session-composer-state.ts` 的 `myPermissionIds` resource 以**布尔 memo**为 source,只在 false→true 沿
fetch 一次 `permission.list()`;同 session 树先后 pending 两个权限时,后到的本地权限 B 不在陈旧快照里
→ 过滤 fail-closed → B 的卡片永不弹 → turn 挂死(飞书侧 240s 超时)。且过滤只做在 composer 一处,
侧栏徽标 / 头像指示用未过滤数据 → 幻影徽标。

## 方案

1. **签名驱动 refetch**:fork-only `context/permission-resolvable.ts` — `candidateSignature`(候选权限
   id 集签名,排除 autoResponds)+ `createResolvableCache`(空签名不 fetch / 同签名去重 / 乱序丢弃 /
   失败 null fail-open);
2. **过滤下沉 `context/permission.tsx`**:按 directory 的 resolvable id 集共享视图,暴露
   `canResolve(permission, directory)`;composer / sidebar-items(项目徽标 + session 徽标)/
   project-avatar-state 统一消费;composer 删私有 resource。
   gate 语义保留:effect 只在候选签名非空时 fetch(e2e/离线不冒 ERR_CONNECTION_REFUSED)。

## R8 测试用例清单

- [x] 签名:跨 session 排序稳定、排除项生效、空集空串(unit)
- [x] **复现主线**:先 A 后 A+B → 两次 fetch(旧实现一次导致 B 藏死)(unit,[bug-repro])
- [x] 空签名恒不 fetch(e2e/离线 gate)(unit)
- [x] fetch 失败 → null fail-open(unit)
- [x] 乱序响应:旧签名结果丢弃(unit)
- [x] 运行时:timeline/离线场景不冒网络错 → 批次 e2e(playwright + smoke)兜底
- [ ] 真并发权限双卡片行为(飞书无人值守流)→ 真机抽查,🟡 不阻断

## 验收(对照需求池)

- 同 session 两个权限先后到,第二个本地权限卡片能弹(签名 refetch 单测覆盖判定链);
- e2e 回归不冒网络错、smoke 不失败(批次端到端统一跑);
- 侧栏徽标 / 头像与 composer 过滤一致(同一 canResolve 数据源,结构性保证)。
