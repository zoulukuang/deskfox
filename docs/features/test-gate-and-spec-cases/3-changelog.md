feat-id: test-gate-and-spec-cases
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# changelog

## 规模

Medium(治理文档升级 + pre-push hook ~20 行)。纯 fork:0 改上游 / 0 R4。

## 改动文件

| 文件 | 改动 |
|---|---|
| `.husky/pre-push` | main-push 块新增 fork 包单元测试闸(media-gen/adapter-feishu-lark/app),red 拦 push;附 FORK 注释说明范围与跳过方式。 |
| `docs/governance/自动化测试规范.md` | 决策 1 规模表加 R8;新增 R8(测试用例清单)/ R9(分支内验收闸)说明;操作流程「写新 feat / 修 bug」纠偏(删过时「ff merge dev → push 双远端」,改标三铁律授权点);CI 集成表「当前」行补 fork 单测;修订记录 v5。 |
| `CLAUDE.md` | R5 段加 R8/R9 两条 + 更新 pre-push 守门现状;规范修订记录 v3.2。 |
| `docs/features/test-gate-and-spec-cases/` | 三文档(1-spec 含 R8 dogfood 用例清单)。 |
| `docs/features/INDEX.md` | 索引一行。 |

## 两条新规则(摘要)

- **R8 测试用例清单**:Medium+ 的 1-spec 动工前列逐条可勾选测试用例(验什么/层级 unit·Phase1·Phase2·CDP/预期),运行时·native 风险点显式列入。
- **R9 分支内验收闸**:开发完按 R8 跑全套+全绿、问题 feat 分支内解决,才向 user 提 merge;`pre-push` push-main 时跑 fork 包单测作自动 backstop。

## 影响

- **无运行时/产品行为变化**:纯流程+文档,加上 push 到 main 时多跑 ~25s 单测(可 `--no-verify [override-pre-push:]` 跳过)。
- feat 分支日常 push 不受影响(闸只在 push 含 main 时触发)。

## 回归测试(R8 清单,7/7 过)

1. `sh -n .husky/pre-push` 语法 OK。
2. 三 fork 包 main 上全绿:media-gen 140 / adapter-feishu-lark 650 / app 780,合计 ~25s。
3. 闸通过路径:全绿 → `fork_unit_fail=0`(放行)。
4. 闸失败路径:注入 false → `fork_unit_fail=1` → exit 1(拦截)。
5. 闸范围仅 fork 三包,不碰上游。
6. 治理文档无残留过时「ff merge dev」(仅纠偏后带授权门的行)。
7. CLAUDE.md 与测试规范 R8/R9 措辞一致、互指。

## 回退

`git revert <merge>`;或还原 4 个文件。纯文档+hook,无运行时状态。
