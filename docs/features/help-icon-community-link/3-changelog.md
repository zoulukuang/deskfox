feat-id: help-icon-community-link
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 左下角"?"帮助入口指向 DeskFox 社区页

> Tiny feat(1 行代码改动),按规范只写 3-changelog;需求来源 = 需求池 REQ-039。

## 需求(REQ-039)

左侧栏底部、设置齿轮下方的"?"问号图标点击后,用外部浏览器打开 `https://deskfox.ai/#community`(社区 community 锚点),给用户一个进社区 / 求助入口。来源:用户 2026-06-01 提,2026-06-02 实现。

## 实际改动

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/app/src/pages/layout.tsx:2363` | 1 行(URL 替换)+ FORK marker 注释 | `onOpenHelp` 的 `platform.openLink` 目标 `https://opencode.ai/desktop-feedback` → `https://deskfox.ai/#community` |

改动前后:

```tsx
// 改前
onOpenHelp={() => platform.openLink("https://opencode.ai/desktop-feedback")}
// 改后
// FORK: 帮助入口指向 DeskFox 社区页,替换上游 opencode.ai feedback (REQ-039) 2026-06-02
onOpenHelp={() => platform.openLink("https://deskfox.ai/#community")}
```

## 技术说明

- "?" 图标(`sidebar-shell.tsx:102-110` 的 `IconButton icon="help"`)早已接好 `onClick={props.onOpenHelp}`,**功能本就存在**,本需求只是把目标 URL 换成 DeskFox 社区页。
- `platform.openLink` 在 Tauri 桌面端(`packages/desktop/src/index.tsx:140`)走 `shellOpen`(tauri-plugin-shell)→ 真正用系统**外部浏览器**打开,符合需求"外部浏览器打开"。
- 顺手修掉一处上游 `opencode.ai` brand leak(R3 品牌字眼)。
- 注:`packages/app/src/pages/error.tsx:321` 还有一处 `https://opencode.ai/desktop-feedback`(错误页反馈链接),**不在本需求范围**,未动(避免 scope 蔓延)。

## 影响范围 / 测试 / 回退

- **规模**:Tiny(1 行代码 + 1 行注释,1 文件)。R5 例外清单 Tiny < 50 行不强制测试。
- **验证**:`bun run typecheck` 17/17 全过(确认 JSX 属性间 `//` 注释合法 + 改动不破类型)。功能逻辑通路(onClick → openLink → shellOpen)早有,无新逻辑分支。
- **R4 override**:0。**上游侵入**:1 行(layout.tsx,已加 FORK marker)。
- **回退**:`git revert` 本 commit,或把 URL 改回 `https://opencode.ai/desktop-feedback`。

## Follow-up(2026-06-02):顶部「帮助」菜单 + 错误页链接同步去 opencode 化

用户在 "?" 图标实测通过后,要求把顶部原生菜单栏「帮助」下拉里的链接、以及错误页反馈按钮也一并指向 DeskFox 自有地址(同主题延展,放同一 feat 分支)。映射由用户拍板:

| 位置 | 文件:行 | 改前 | 改后 |
|---|---|---|---|
| 帮助 → 支持论坛 | `packages/desktop/src/menu.ts:173` | `discord.com/invite/opencode` | `https://deskfox.ai/#community` |
| 帮助 → 分享反馈 | `packages/desktop/src/menu.ts:186` | `github.com/anomalyco/opencode/issues/new?template=feature_request.yml` | `https://github.com/zoulukuang/deskfox/issues/new` |
| 帮助 → 报告错误 | `packages/desktop/src/menu.ts:190` | `github.com/anomalyco/opencode/issues/new?template=bug_report.yml` | `https://github.com/zoulukuang/deskfox/issues/new` |
| 错误页反馈按钮 | `packages/app/src/pages/error.tsx:321` | `opencode.ai/desktop-feedback` | `https://github.com/zoulukuang/deskfox/issues/new` |

- **「帮助 → 文档」(`menu.ts:169` `opencode.ai/docs` + i18n 文案「OpenCode 文档」)用户决定暂不动**,留待 DeskFox 文档站就绪后再改。
- 两处上游文件改动均加 FORK marker(menu.ts 支持论坛单行 marker + 反馈/报错 FORK-BEGIN/END;error.tsx 单行 marker)。
- **遗留 UI 小瑕疵**:error.tsx 反馈按钮仍配 discord 图标 + `error.page.report.discord` 文案,链接已改 GitHub —— icon/文案是否同步调整待用户定(本次只按要求改链接)。
- 规模:Follow-up Tiny,2 上游文件 4 处 URL / typecheck 17/17 全过 / 0 R4。
- 回退:`git revert` follow-up commit。
