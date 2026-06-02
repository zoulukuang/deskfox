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
