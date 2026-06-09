---
feat-id: feishu-settings-workspace-above-advanced
status: done
related: ./3-changelog.md
---

# 3-changelog — feishu-settings-workspace-above-advanced

> Tiny 规模(纯 JSX 顺序重排,1 文件、无逻辑/state/handler 变化),按规范只写 3-changelog.md。

## 背景 / 需求

飞书「编辑账号设置」dialog 里,字段从上到下原顺序是:
**模型 → 高级能力(分隔 + /group 说明 + 免@ checkbox)→ 工作目录(分隔 + 路径选择)**。

user 要求把**「工作目录」整个区域上移到「高级能力」之上**,即更靠近常用的模型设置,高级能力下沉为次要。

## 修法

`packages/app/src/components/feishu-edit-account-dialog.tsx` 单文件,在 `<form>` 内对两个相邻区块做**整体顺序对调**(纯视觉,无逻辑改动):

调整后顺序:**模型 → 工作目录(分隔 + 路径选择)→ 高级能力(分隔 + /group 说明 + 免@ checkbox)**。

- 工作目录两块(分隔块 + 内容块)整体提到高级能力分隔块之前;
- state(`workspace`/`requireMention`)、handler(`handlePickWorkspace`/`setWorkspace`)、保存逻辑、i18n key **全部不动**;
- 顶部加 FORK marker `[feat: feishu-settings-workspace-above-advanced] 2026-06-09`;
- dialog description 文案「设置对话模型 + 高级能力」**未改**(工作目录原本就不在描述里,描述只点功能大类)。

## 验证

- monorepo typecheck **16/16**。
- app 包全量 **830 pass / 0 fail**(纯重排,0 回归;`feishu-edit-account-model.test.ts` 等现有逻辑测试不受顺序影响)。
- ⚠️ 纯视觉顺序由 dev 包真机肉眼验收(View 清单 e2e 门槛未生效;R5 Tiny 无逻辑变化豁免新单测)。

## 规模 / 影响

- **Tiny**:1 文件,JSX 区块顺序对调,净 +1 行(FORK marker 注释),全 fork-only 已有 fork 文件。
- **回退**:`git revert` 本 commit。
- **0 改上游 / 0 R4 override / 0 黑名单 / 0 新增逻辑**。
