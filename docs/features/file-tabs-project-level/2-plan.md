feat-id: file-tabs-project-level
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划 + 决策轨迹

## note 1 — 为什么新增 projectTabs 而非复用 sessionTabs 改 key
`sessionTabs` 被 `prune`(按 MAX_SESSION_KEYS=50 LRU 清理会话)+ `sessionView` 一起算上限。若直接把 sessionTabs 的 key 改成 dir,会和 sessionView 的 sessionKey 混在同一上限里,prune 逻辑混乱。新增独立 `projectTabs[dir]` 把项目级 tab 从 prune 摘出来(项目数少,不需 LRU 清理),最干净。旧 sessionTabs 不再写入,prune 删空 sessionTabs 无害。

## note 2 — projectTabKey 提纯文件的原因
单测若 `import "./layout"` 会拉起整个 layout context(solid/persist/platform 重依赖),bun test 易加载失败(参考 file-tree.test 的 client-only API 教训)。故把 `projectTabKey` 放零依赖 `context/session-key.ts`,测试只 import 纯文件,稳。

## note 3 — active 边界(审查 tab 切无 diff 会话)
active 项目级 → 切到无 diff 会话仍可能是 "review"。`createSessionTabs.activeTab`(helpers.ts)对 review 的判断是 `active==="review" && review()`(review()=isDesktop)。无 diff 时 review tab Trigger/Content 不渲染(canReview gate),但 active="review" 会落到 reviewPanel 渲染 → session 层在无 diff 时显示"暂无更改"空状态。不崩、合理,**不改 helpers**(改了会引入 loading 期闪烁)。留观察,真桌面 QA 若觉得空白突兀再议。

## note 4 — 不迁移旧数据
旧 `sessionTabs`(会话级)持久化数据保留在 layout.v6 但不再读。用户升级后第一次:旧会话的文件 tab "消失"(其实是不再按会话读),需重开一次文件 → 之后项目级记住。一次性、成本低,user 已接受。未单独写 migrate 清旧数据(留存无害,占用极小)。

## 实施顺序
1. store 加 projectTabs → tabs() 全方法切 projectTabs[projectTabKey] →(typecheck)
2. 提 projectTabKey 到 session-key.ts + 单测 →(test + typecheck)
3. e2e 回归 → build → 真桌面 QA → commit
