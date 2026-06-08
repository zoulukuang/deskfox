feat-id: feishu-edit-dialog-ux
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实施计划 + 决策轨迹

## 实施顺序

1. **后端先行**(数据/语义打底):
   - `deskfox-dir.ts`:导出 `DEFAULT_IMBOT_WORKSPACE`(收口 message-pipeline 的局部常量)+ `resolveWorkspace(ws)`(= `normalizeWorkspace(ws) ?? DEFAULT`)。
   - `message-pipeline.ts`:`workspaceDir()` 改用 `resolveWorkspace`;新增纯函数 `pickFirstFreeModel(providersData)`;新增 `effectiveModel()`(哨兵→解析,缓存 10min,空→null);`runOpencode` promptAsync + `checkModelVisionSupport` 都走 `effectiveModel()`。
   - `server.ts` `/accounts`:加 `workspaceEffective: resolveWorkspace(account.workspace)`。
2. **Rust 透传**:`feishu_adapter.rs` wire item + `AccountSummary` 加 `workspace_effective`(`#[serde(rename=...)]` + `#[serde(default)]`)。
3. **前端**:
   - 新 helper `feishu-edit-account-model.ts`(纯函数,Logic 清单)。
   - `feishu-config.ts`:`AccountSummary.workspace_effective?: string`。
   - dialog:删 `useDefault` signal + 勾选区 + `defaultModelLabel`;provider 默认 opencode、model 默认哨兵;modelOptions 经 helper 注入"自动";标题 description 传 `<botName>(id)`;新增 prop `botName` / `currentWorkspaceEffective`。
   - settings-feishu:`handleEdit` 传 `botName` + `currentWorkspaceEffective`;列表加 workspace 行。
   - i18n en/zh/zht:加 `settings.feishu.edit.autoFreeModel` + `.autoFreeModel.hint`;删 `useDefault` / `useDefault.hintFollow` / `useDefault.hintCustom` / `defaultUnset`。
4. **测试**:helper 单测 + 扩 deskfox-dir.test;typecheck;fork 包单测;i18n completeness。

## 决策轨迹

- **哨兵 vs 新布尔字段**:选哨兵 `{opencode, __auto_free__}` —— 复用现有 `{providerID, modelID}` 全链路(account-store/server/config-schema/Rust 均接受任意非空 string),0 schema 改动。新增字段要改 5 处类型。
- **默认路径单一真相源**:`message-pipeline.ts:264` 的 `IMBOT_WORKSPACE` 是局部常量;server.ts 也要用 → 上提到 `deskfox-dir.ts` 导出,pipeline import 回去,消除两份定义漂移。
- **vision 预检的坑**:`checkModelVisionSupport` 原直接读 `account.model`,若读到哨兵会查不到 model → 误判不支持 vision 卡住图片。故必须先 `effectiveModel()` 解析再查。已列为 T14 真机验。
- **i18n 只改 en/zh/zht**:completeness 测试只守这 3 本,其余 14 语言 merge 时 fallback en。列表 `workspace:` 标签硬编码(对齐既有 `openId:`/`agent:` 字面量风格,非 i18n)。

(开发中踩坑实时追加)
