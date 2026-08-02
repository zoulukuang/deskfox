feat-id: feishu-session-project-visibility
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动记录

## commit

- (本笔 commit)`feat(feishu): REQ-086 绑定默认 workspace=当前项目 + 重绑保留设置 [feat: feishu-session-project-visibility]`(分支 feat/daily-ux-batch)

## 实际改动

| 文件 | 行数 | 说明 |
|---|---|---|
| `packages/app/src/components/feishu-bind-workspace.ts` | +17(新) | `defaultWorkspaceForBind` 纯逻辑(Logic 清单) |
| `packages/app/src/components/feishu-bind-workspace.test.ts` | +29(新) | T1-T4 |
| `packages/app/src/components/feishu-bind-dialog.tsx` | +60 | OAuth 成功后回查账号 → 未设 workspace 且有打开项目则注入;成功页三态提示(defaulted/kept/fallback);有提示时自动关窗 1.2s→5s |
| `packages/app/src/components/feishu-edit-account-dialog.tsx` | +8 | workspace 空态显著提示「不进项目列表」 |
| `packages/app/src/i18n/{zh,zht,en}.ts` | +10×3 | 新 key ×4 |
| `packages/adapter-feishu-lark/src/feishu/account-store.ts` | +4 | saveAccount 重绑保留 `model`/`workspace`(bug fix) |
| `packages/adapter-feishu-lark/src/__tests__/account-store.test.ts` | +53(新) | T5-T6 bug-repro |

## 影响范围

- 前端 app(feishu 绑定/编辑 dialog + i18n)+ adapter-feishu-lark(fork-only 包)。0 上游黑名单文件,0 R4。
- 行为变化:① 绑定新账号且当前开着项目 → workspace 自动=该项目(旧行为:恒为全局 imbot-workspace);② 重绑不再丢 per-account model/workspace;③ 成功页/编辑页新增落盘与可见性提示。
- 存量无 workspace 账号不自动迁移(编辑页提示引导)。

## 回归测试

- `bun test account-store.test.ts` 2 pass;app `feishu-bind-workspace.test.ts` 4 pass;app/adapter typecheck 绿。
- 真机 T7(飞书发消息 → 项目列表出现 session)/ T8(编辑页空态提示)随发版验收,含 REQ-093 联动 blocker(plugin ctx.directory 一致性)。

## 回退方法

单 commit `git revert`;无数据迁移(workspace 注入走既有 update-settings 端点,revert 后新绑定回到旧行为,已注入的账号 workspace 保留可手动清)。
