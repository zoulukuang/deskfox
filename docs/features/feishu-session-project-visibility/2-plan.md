feat-id: feishu-session-project-visibility
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划

## 改动清单

| 文件 | 改动 |
|---|---|
| `packages/app/src/components/feishu-bind-workspace.ts` | 新增:`defaultWorkspaceForBind(currentDir, existingWorkspace)` 纯逻辑(Logic 清单) |
| `packages/app/src/components/feishu-bind-workspace.test.ts` | 新增:T1-T4 |
| `packages/app/src/components/feishu-bind-dialog.tsx` | OAuth 成功后:列表查该账号 workspace → helper 判定 → `feishuUpdateAccountSettings` 注入;成功页三态提示(defaulted/kept/fallback);自动关窗 1.2s → 有提示时 5s |
| `packages/app/src/components/feishu-edit-account-dialog.tsx` | workspace 空态加「不进项目列表」warning |
| `packages/app/src/i18n/{zh,zht,en}.ts` | 新 key ×4 |
| `packages/adapter-feishu-lark/src/feishu/account-store.ts` | saveAccount 重绑保留 `model`/`workspace` |
| `packages/adapter-feishu-lark/src/__tests__/account-store.test.ts` | 新增:T5-T6(bug-repro) |

## 决策轨迹

- 当前项目目录取法:dialog 内 `useParams()` + `decode64(params.dir)` — settings-general.tsx:89-95 已验证同模式在 dialog 内可用,不新增 context 依赖。
- workspace 注入复用 `feishuUpdateAccountSettings`(save 端点不加字段),零 adapter API 变更;失败 best-effort 降级 fallback 提示,不阻断绑定。
- 「仅当账号未设 workspace 才注入」靠 save 后 `feishuListAccounts()` 回查(save 响应恒返 workspace:null 不可信,desktop feishu.ts:199 注释明示)。
- 重绑丢 model/workspace 是二次复核新发现的毗邻 bug,`existing?.model`/`existing?.workspace` 两行修复 + bug-repro 测试同 commit。
- 成功页自动关窗 1.2s 看不完落盘提示 → 有提示时延至 5s,保留「完成」按钮可立即关。
