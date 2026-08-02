feat-id: imbot-agent-schema-upgrade
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动记录

## commit

- (本笔 commit)`feat(desktop): REQ-094 imbot agent 按 _schemaVersion 自动升级 [feat: imbot-agent-schema-upgrade]`(分支 feat/daily-ux-batch)

## 实际改动

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/desktop/src/main/deskfox/imbot-agent.ts` | +74(新) | spec + 三分支升级纯逻辑 |
| `packages/desktop/src/main/deskfox/imbot-agent.test.ts` | +80(新) | T1-T6 |
| `packages/desktop/src/main/deskfox/plugin-install.ts` | −36/+5 | spec/inject 迁出改 import |

## 影响范围

- fork-only `packages/desktop/src/main/deskfox/`,非黑名单,0 R4。
- 行为变化:存量用户旧 imbot agent 在下次启动自动升到当前档(覆盖 `_schemaVersion`/`description`/`permission`,保留 model/prompt/tools 等用户键);同/高版本零写盘。发版 release notes 需注明「直改 imbot.permission 会被覆盖,自定义请另起 agent 名」。
- `_schemaVersion` 未知键经 core `StructWithRest` 校验安全(已实证)。

## 回归测试

- 6 单测 pass;desktop typecheck 绿。T7(真机 V2 残留 jsonc 启动升 V3)在本批端到端阶段跑。

## 回退方法

单 commit `git revert`;已被升级的用户 config 不随 revert 回退(新 spec 字段对旧版本兼容,无害)。
