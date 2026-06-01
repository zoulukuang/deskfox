feat-id: test-gate-and-spec-cases
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 步骤

1. 读实际执行链条(.husky/pre-commit + pre-push)+ 《自动化测试规范》全文,定位缺口。
2. 探测测试命令范围:根 `test` 故意禁、无 turbo test task → 闸只能按 fork 包跑;实跑 media-gen/adapter-feishu-lark/app 确认绿 + 计时(~25s)。
3. 改 `.husky/pre-push`:main-push 块加 fork 包单测闸。
4. 改《自动化测试规范》:R8/R9 + CI 表 + 操作流程纠偏 + v5。
5. 改 `CLAUDE.md`:R5 段加 R8/R9 + 修订记录 v3.2。
6. 按 R8 dogfood 跑本 feat 的 7 条用例清单。

## 决策轨迹

- **闸范围 = fork 包,不跑全 monorepo**:根 test 被故意禁(`echo 'do not run' && exit 1`),上游包测试非我们维护、可能不绿,跑全仓会堵死 push。只跑 media-gen/adapter-feishu-lark/app(我们真正关心、且已绿)。
- **闸放 main-push,不放每次 push**:沿用 hook 既有设计(feat 分支 push 保持轻)。主闸仍是 R9 人工按清单验收;hook 是 push-main 兜底。
- **不新增 CLAUDE.md 顶层硬约束章节,而是给 R8/R9 编号并落在测试规范**:与既有 R5(决策1)/R7(决策4)同模式 —— 测试类规则编号但住在测试规范,CLAUDE.md R5 段只放指针。避免 CLAUDE.md 硬约束段膨胀(对照元原则)。
- **顺手纠偏而非只叠加**:借这次梳理删掉操作流程里与三铁律矛盾的过时步骤,体现"梳理=砍+合,不只加"。

## 验证

R8 清单 7 条全过(sh -n / 三包实跑绿 / 闸 pass+fail 两路径 / 范围 / 文档无残留 / 双文档一致)。
