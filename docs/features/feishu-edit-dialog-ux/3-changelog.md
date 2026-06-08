feat-id: feishu-edit-dialog-ux
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实际改动 changelog

> 规模:Medium。net +594 行(含测试 +158 / 文档 +108);9 个代码文件 + 3 测试 + 2 文档。
> 几乎全 fork-only;上游侵入仅 `app/src/i18n/{en,zh,zht}.ts`(i18n,本就是 fork 编辑面)。

## 三 Ask 落地

### Ask ① 去"跟随默认"勾选,默认"自动免费模型"(动态)
- 弹窗移除"跟随 DeskFox 默认(推荐)"勾选区 + 动态 hint + latent-bug 的 `defaultModelLabel`。
- 首次进入默认预选 **OpenCode Zen + "自动(始终用免费模型)"**;两个下拉始终可用。
- "自动" = 哨兵 `{provider_id:"opencode", model_id:"__auto_free__"}`,**保存的是哨兵不是具体 model**;
  pipeline 发请求前 `effectiveModel()` 实时解析成 OpenCode Zen 当下第一个免费模型
  (`pickFirstFreeModel`,判据 `!cost || cost.input===0`,与前端 dialog-select-model 一致),
  故 opencode 换免费模型也自动跟上;解析不到/离线 → null 回退全局默认(promptAsync 不带 model)。
- **vision 预检改走 effectiveModel()**:否则哨兵 `__auto_free__` 当真 modelID 查 providers 必查不到 →
  误判不支持 vision 卡死图片(spec T14)。
- 免登录:`provider.ts` 未认证时只留免费模型 + `apiKey:"public"`(上游设计),全新用户开箱即用。

### Ask ② 顶部文案带 bot 名
- dialog 加 `botName` prop;description 的 `account` 参数传 `<botName>(cli_xxx)`,无名回退纯 id。

### Ask ③ 账号列表加 workspace 目录行
- adapter `/accounts` 回 `workspaceEffective`(解析后绝对路径)→ Rust 透传 → 列表显示真实目录;
  未单独设 = 全局默认绝对路径(`~/.opencode/imbot-workspace` 展开),非抽象"home base"字样。
- 弹窗 workspace 空态也顺带显示该真实默认路径(`workspace.defaultPath`)。

## 文件改动

| 文件 | 改动 |
|---|---|
| `app/.../feishu-edit-account-model.ts`(新) | model 选择纯逻辑:AUTO_FREE 哨兵常量 + initialModelSelection/buildModelOptions/defaultModelForProvider/toModelPayload/isAutoFree(Logic 清单) |
| `app/.../feishu-edit-account-dialog.tsx` | 去勾选/默认自动免费/标题带 bot 名/空态真实路径(View 清单) |
| `app/.../settings-feishu.tsx` | 列表加 workspace 行 + 传 botName/workspaceEffective |
| `app/.../utils/feishu-config.ts` | AccountSummary.workspace_effective |
| `app/src/i18n/{en,zh,zht}.ts` | +autoFreeModel(+hint)+workspace.defaultPath;删 4 个 useDefault/defaultUnset 死 key |
| `adapter-feishu-lark/.../deskfox-dir.ts` | 导出 DEFAULT_IMBOT_WORKSPACE + resolveWorkspace(单一真相源) |
| `adapter-feishu-lark/.../message-pipeline.ts` | IMBOT_WORKSPACE 收口 + pickFirstFreeModel + effectiveModel + modelHintLabel;vision/promptAsync 走 effectiveModel |
| `adapter-feishu-lark/src/server.ts` | /accounts 回 workspaceEffective |
| `desktop/.../feishu_adapter.rs` | wire + AccountSummary 加 workspace_effective 透传 |

## 测试(R8 清单对照)

| 用例 | 文件 | 状态 |
|---|---|---|
| T1-T6 model 选择逻辑 | `feishu-edit-account-model.test.ts` | ✅ 12 pass |
| T7/T15 pickFirstFreeModel + 离线兜底 | `pick-first-free-model.test.ts` | ✅ |
| T8 resolveWorkspace | 扩 `deskfox-dir.test.ts` | ✅ |
| T9-T12 View / 集成 | dialog 渲染 / 标题 / 列表 / 哨兵往返 | ✅ 真机 QA 通过 2026-06-09 |
| T13 免登录自动免费真机回复 | native | ⏳ 日常使用验证 |
| T14 哨兵 vision 预检不误判 | native | ⏳ 日常使用验证 |

## 真机 QA 暴露并修复(R9 分支内解决)

- **Ask③ workspace 行不显示**:`AccountSummary.workspace_effective` 误加 `serde(rename=camelCase)`,
  前端读 snake_case 读不到 → 删 rename 对齐其它字段。
- **列表哨兵裸 id**:`opencode/__auto_free__` → 改显「自动(始终用免费模型)」友好文案(`isAutoFree`)。
- 重 build + 真机复验:workspace 行正常显示真实目录 + 哨兵友好文案 ✓(commit `81fc63da0`)。

## 验证

- typecheck 16/16 ✓ / adapter 740 ✓ / app 826 ✓ / media-gen 140 ✓ / i18n 9 ✓ / cargo check clean ✓

## 回退方法

- 纯 fork 文件,可单独 `git revert` 本 feat 的 merge commit;无 DB/配置迁移,无数据残留
  (存量哨兵账号 revert 后后端不识别 `__auto_free__` → 当成具体 model 传给 promptAsync 会失败,
   需 user 重新编辑账号选具体 model;实践上 revert 前先确认无账号已存哨兵)。

## commit

- `fe9fc34d9` 后端:pipeline 自动免费模型解析 + workspace 路径单一真相源
- `7481d9551` 前端:编辑弹窗去跟随勾选+默认自动免费 / 标题带 bot 名 / 列表显 workspace
- `84642f6e0` docs:三文档
- `65a75f182` docs:填 hash + INDEX 登记
- `81fc63da0` fix:QA 修 workspace_effective 序列化 + 列表哨兵友好文案
