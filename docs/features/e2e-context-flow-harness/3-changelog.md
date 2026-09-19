feat-id: e2e-context-flow-harness
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实际改动记录

## commit

| # | commit | 内容 | 行数 |
|---|---|---|---|
| 1 | `95a64d945a` | 1-spec + 2-plan | +226 |
| 2 | `590e0c4aa7` | 工具 `utils/context-flows.ts` | +330 |
| 3 | `899eb63f7a` | v2 判据同源 + 测试契约 + 首批 6 条用例 | +227 / −4 |
| 4 | `2299e4756f` | **收口到经典布局** + 用例 6→8 | +175 / −136 |

## 改动清单

**产品侧(3 文件,约 25 行)**

| 文件 | 改什么 | 为什么 |
|---|---|---|
| `session-ui/.../prompt-input/interaction.ts` | `comments()` 与 `canSubmit()` 两处判据从 `!!item.comment?.trim()` 放宽为「只看有没有卡」 | 修 1-spec §三 那个 bug:无注释卡在新版界面下静默失效 |
| `session-ui/.../prompt-input/index.tsx` | v2 卡片条每张卡补 `data-context-card` / `data-path` / `data-has-comment` / `data-comment-id` / `data-kind` | e2e 要断言卡片**身份**,不只数个数 |
| `app/src/components/prompt-input/context-items.tsx` | legacy 卡片补同一套属性 + 容器 `data-component="prompt-context-items"` | 两套布局共用一份选择器 |

**测试侧(2 新文件)**

- `app/e2e/utils/context-flows.ts` —— 核心流程驱动(bootstrap / 开文件 / 真鼠标选区 /
  右键加入聊天 / 卡片身份读回 / 发送 / 翻历史 / @ 引用 / 聊天区选区)。
  文件头写清 5 条部落知识,防止后来人绕过 helper 自己写又踩一遍。
- `app/e2e/regression/context-card-flows.spec.ts` —— 6 条用例(R8 的 1 / 2 / 6+7 / 8 / 10 / 11)。

## 影响范围

- 上游文件 2 个(session-ui),均带 FORK marker;`packages/session-ui` 不在黑名单,无需 R4 override。
- 用户可见变化:**新版界面下,不填注释的引用卡现在会显示出来、发送键会亮起**
  (此前静默失效但卡已进 store、会偷偷跟着下一条消息发出去)。
- 无 API / 数据格式变更;`data-*` 属性纯附加。

## 回归测试

| 项 | 结果 |
|---|---|
| `bun run typecheck` | 33 / 33 |
| `packages/app` 单测 | 1186 pass / 0 fail |
| `packages/session-ui` 单测 | 121 pass / 0 fail |
| 新增 e2e `context-card-flows.spec.ts` | **8 pass / 0 fail(15.3s,经典布局)** |
| **全量 e2e** | **150 pass / 0 fail(2.2m)** |
| 反证 | 把 `interaction.ts` 两处判据退回 → 用例「adds a visible card even without a comment」立刻红(0 张卡) |

## 回退方法

单独 `git revert` 本笔即可:
- 产品侧回退后,无注释卡在新版界面重新静默失效(即回到 2026-09-19 前的状态);
- 测试侧两个新文件是纯新增,revert 不影响任何既有用例;
- `data-*` 属性移除后没有其他消费者(只有本批 e2e 用)。

## 遗留

见 1-spec §七「后续项」:经典布局覆盖 / 聊天区与 @ 引用用例 / 命令
「将所选内容添加到上下文」实际不可达(需单独评估是恢复入口还是摘掉命令)/ 是否进 pre-push 闸。
