feat-id: session-presentation-input-batch
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 会话呈现与输入修复批 — 3-changelog

(待施工后按批填:实际改动 / commit hash / 行数 / 影响范围 / 回归测试 / 回退方法。)

已先行落库的关联 commit(本批开工前已在 main):

| commit | 内容 |
|---|---|
| `f40f88d505` | REQ-112 复现单测 `permission-resolvable-source.test.ts`(4 例)+ 验收闸 `packages/app/scripts/check-child-store-reads.sh` [feat: permission-filter-concurrency] |
| `c86f3efa61` | 上述复现用例 typecheck 修复 |
| `d79da924de` | merge 进 main(截至 2026-08-17 本地未 push) |
