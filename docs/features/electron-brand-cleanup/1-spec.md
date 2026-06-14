feat-id: electron-brand-cleanup
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 规格(spec)

> **唯一事实源**:本需求的完整规格 / 取舍判定 / 触点清单 / 任务清单在 OPENCODE-PLAN 需求池
> `D:\project\OPENCODE-PLAN\需求池\electron-DeskFox品牌残留-接线补齐.md`(2026-06-14 已对齐,可开发)。
> 本文件只做电子仓内索引 + 一句话摘要,不重复正文(避免双轨)。

## 一句话

换基座(Tauri → Electron)时 Electron 桌面入口**绕开了 fork 已有的品牌单一源**(`packages/branding/` 资产 +
`packages/app/src/i18n/rebrand.ts` 文本),导致预览版实机仍露 OpenCode 品牌(启动画面 □、任务栏标题、
设置/升级 toast 文案、通知图标外网 favicon、卸载列表发布者)。本需求把入口**接回单一源**(不新建机制、
不逐 key 手改、不逐 surface 造组件),并修少量真正独立的缺陷。

## 规模

Small–Medium。多为接线:import 换源 + 在 i18n 出口套已有 `rebrandDict` + 拷图标资源到对位置;
少量独立修复(窗口标题锁定 / 通知图标本地化 / 卸载发布者 / 误发护栏)。

## 核心约束(治理)

- **不另起并行机制**:文本只动 `rebrand.ts` + 在出口套用;资产只用 `branding/`;禁止第二套品牌字典/组件/图标逻辑。
- **R2 FORK marker**:改上游文件必加。
- **保留清单(白名单)= `rebrand.ts` 唯一事实源**:`OpenCode Zen` / `OpenCode Go`(官方专名)、`wsl.*`(真实 CLI 名)、
  `error.chain.mcpFailed`(研发向)、`dialog.model.unpaid.freeModels.title`(提供方归属);console 不纳入(§七)。

## 验收

dev channel 真机冷启动逐项核验(需求池 §八 1–9):启动画面狐狸 / 任务栏标题 DeskFox Dev / 图标 DeskFox /
通知离线可显示 / 文案无 OpenCode(白名单除外)/ 卸载发布者 DeskFox / 三档不串档 / 护栏 / i18n 无回潮断言。
