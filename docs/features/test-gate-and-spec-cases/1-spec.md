feat-id: test-gate-and-spec-cases
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 测试纪律升级:R8 测试用例清单 + R9 分支内验收闸 + 单元测试自动 backstop

## 背景

2026-06-01 catalog 数据/代码分层(`media-catalog-data-extract`)merge 后才发现 UI 能力标签不一致,暴露两个流程缺口:
1. 测试范围没在动工前固定 → 验证靠临时探索,易漏。
2. "绿了再 merge"只是流程文字,不是硬门槛;`pre-push` 单测 gate 一直"后续接入"悬空(只跑 typecheck + Phase1 e2e)。

user 拍板补两条规则并把单测闸真正接上(选"最彻底")。

## 范围

1. **R8 测试用例清单**:Medium+ 的 1-spec 必须动工前列逐条可勾选测试用例(验什么/层级/预期),运行时·native 风险点显式列入。
2. **R9 分支内验收闸**:开发完按 R8 跑全套+全绿、问题在 feat 分支解决,才向 user 提 merge。
3. **pre-push 自动 backstop**:push 含 main 时跑 fork 自家包单元测试(media-gen/adapter-feishu-lark/app)。
4. **流程纠偏**:删《自动化测试规范》里与三铁律矛盾的过时「ff merge dev → push 双远端」。

落地文件:`docs/governance/自动化测试规范.md`(R8/R9/CI 表/流程/v5)、`CLAUDE.md`(R5 段 + 修订记录)、`.husky/pre-push`(单测闸)。

## 不做

- 不强制全 monorepo 测试(根 test 故意禁,上游包测试非我们维护)。
- 不动双清单 debt(dialog-settings/file-tabs 未补 e2e)、不重测 KPI —— 另立。
- 不碰 pre-commit 四闸 / 三铁律本身。

## 测试用例清单(R8 — dogfood 本规则)

| # | 验什么 | 层级 | 预期 |
|---|---|---|---|
| 1 | pre-push 脚本语法合法 | shell `sh -n` | 无语法错误 |
| 2 | 三个 fork 包测试当前在 main 绿 + 耗时可接受 | 实跑 | 全 pass,合计 ~25s |
| 3 | 单测闸通过路径:全绿 → `fork_unit_fail=0` | shell 构造实跑 | =0(放行) |
| 4 | 单测闸失败路径:任一包 red → `fork_unit_fail=1` → exit 1 | shell 构造实跑(注入 false) | =1(拦截) |
| 5 | 闸只跑 fork 包、不跑上游(范围正确) | 读 hook | 仅 media-gen/adapter-feishu-lark/app |
| 6 | 文档无残留过时「ff merge dev」 | grep 治理文档 | 0 命中(或仅历史 archive) |
| 7 | CLAUDE.md / 测试规范 R8/R9 措辞一致、互相指向 | 读 | 一致 |

## 验收标准

R8 清单 7 条全过;无运行时行为影响(纯流程/文档 + push 期 hook);0 改上游 / 0 R4。
