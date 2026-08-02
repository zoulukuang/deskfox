feat-id: model-capability-ui
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动记录

## commit

- (本笔 commit)`feat(app): REQ-026 图片能力前端拦截 + 模型选择器能力徽标 [feat: model-capability-ui]`(分支 feat/daily-ux-batch)
- user config 数据补齐不入仓(2026-08-02 已完成,备份 `~/.config/opencode/opencode.jsonc.bak-pre-req026-20260802`)

## 实际改动

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/app/src/components/model-capability.ts` | +48(新) | 三态能力判定 |
| `packages/app/src/components/model-capability.test.ts` | +41(新) | T1-T4(5 测试) |
| `packages/app/src/components/prompt-input/attachments.ts` | +25 | add() 拦截 + 多文件分流(FORK marker) |
| `packages/app/src/components/dialog-select-model.tsx` | +12 | 📷/🧠 徽标(FORK marker) |
| i18n ×3 | +7×3 | toast + badge key |
| user config(仓外) | — | getbot 33 模型(7 补 modalities / 4 删死 ID) |

## 影响范围

- 上游文件 2(attachments.ts / dialog-select-model.tsx,非黑名单)+ fork-only 2 新文件 + i18n。0 R4。
- 行为变化:① 当前模型明确不支持图片时粘贴/拖图被拦 + 专属 toast(能力未知仍放行走后端兜底);② 选择器行内 📷/🧠 徽标;③ 本机 getbot 视觉模型图片能力生效(需重启 sidecar / DeskFox)。
- 已知边界:「先贴图后换模型」走后端 ERROR 兜底;getbot 上游加新视觉模型仍需手工补 modalities。

## 回归测试

- 5 单测 pass;app typecheck 绿。T6/T7(getbot 真发图 / 徽标一致性 / claude-code 回归)端到端阶段 + 真机 QA。

## 回退方法

代码单 commit `git revert`;user config 用备份恢复:`cp ~/.config/opencode/opencode.jsonc.bak-pre-req026-20260802 ~/.config/opencode/opencode.jsonc`。
