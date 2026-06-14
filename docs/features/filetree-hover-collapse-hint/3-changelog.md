---
feat-id: filetree-hover-collapse-hint
status: done
related: ./3-changelog.md
---

# 3-changelog — filetree-hover-collapse-hint

> Tiny 规模(纯 hover tooltip,无逻辑/新图标),按规范只写 3-changelog.md。

## 背景 / 需求

`filetree-toggle`(2026-06-04)做了一个隐藏交互:文件树里**再次点击正在查看的文件**会收起整个内容预览区。功能实用但**无发现性** —— 用户不知道它存在。

user 要把它**传递给用户,又不形成干扰**。经讨论(三方案对比)选定**最轻的纯 hover tooltip**:只在"正在查看的那一行"且预览区已开时,鼠标悬停浮出提示,不加任何图标、行布局零变化。

## 修法

| 文件 | 改动 |
|---|---|
| `components/file-tree.tsx` | `FileTreeNode`(行组件)加 `viewerOpen?: boolean` prop + `useLanguage()`;return 用应用内 `Tooltip`(`@opencode-ai/ui/tooltip`)包裹整行,`value`=「点击收起预览」、`inactive={!(viewerOpen && node.path===active)}`、`placement="bottom-end"`(行下方右对齐,不盖文件名)—— 仅「正在查看且预览区已开」那一行包 Trigger wrapper、其余行 `inactive` 直接渲染零侵入。主 `FileTree` 加 `viewerOpen?` prop,**两处 `FileTreeNode` 调用 + 递归子目录 `<FileTree>` 调用都透传**(漏递归 = 子目录文件不显示,见踩坑) |
| `pages/session/session-side-panel.tsx` | 「所有文件」tab 的 `<FileTree>` 传 `viewerOpen={view().reviewPanel.opened()}`(与 toggle 收起条件 `isViewerOpen` 完全一致);「更改/审查」tab 的 FileTree(diff 列表,点击是 focusReviewDiff 非 toggle)**不传**,无 hint |
| `i18n/{en,zh,zht}.ts` | 加 `fileTree.collapsePreviewHint`(Click to collapse preview / 点击收起预览 / 點擊收起預覽);余 14 locale fallback en |

## 踩坑(两轮返工)

1. **原生 `title` 不显示**:首版用 HTML 原生 `title` 属性,本地 build 真机**完全不显示**。根因:Tauri 用的 macOS **WKWebView 默认不渲染 `title` 属性的原生 tooltip**(嵌入式 WebKit 与独立 Safari 行为不同;Electron/Chromium 嵌入式也有同类坑)。改用应用内 `Tooltip` 组件解决。**教训**:WebView 内别依赖原生 `title`/`alt` 做 hover 提示,一律用应用组件。
2. **子目录文件不显示**:`FileTree` **递归**渲染子目录(`<FileTree path={node.path}>`),首版只给两处 `FileTreeNode` 调用透传了 `viewerOpen`,**漏了递归 `<FileTree>` 调用** → 子目录里的文件(用户实测 png/mp4/json 恰在子目录)拿不到 `viewerOpen`、tooltip 不出。补传递归后修复。**教训**:给递归组件加贯穿 prop,递归自调用点必须一并补。

## 设计取舍

- **应用内 `Tooltip` 组件**:靠其 `inactive` prop 让非目标行**完全不包裹**(Switch fallback 直接渲染 children),只有目标那一行加 `Trigger` wrapper —— 侵入面收敛到 1 行;无新增图标、零额外视觉。
- **hint 条件 = toggle 条件**:`view().reviewPanel.opened()`,与 `createOpenSessionFileTab` 的 `isViewerOpen`(line 168)一致 —— 预览区开着时点击才是"收起",所以只有此时才提示,语义准确不误导。
- **只对「所有文件」tab 生效**:diff 列表点击行为不同(聚焦 diff,非 toggle 预览),不挂 hint。

## 验证

- monorepo typecheck **16/16**;app 全量 **835 pass / 0 fail**(含 i18n completeness,0 回归)。
- ⚠️ 纯 hover tooltip,GUI 由 dev 包真机验:打开文件(含**子目录里**的 png/mp4/json)→ 预览区开 → 悬停文件树里那一行 → 行下方右对齐浮出「点击收起预览」→ 点它收起。**真机三轮**(原生 title 不显示 → 换 Tooltip 组件;placement 居中 → 改 bottom-end 右对齐;子目录不显示 → 补递归透传)后通过。R5 Tiny(<50 行、无逻辑)豁免强制单测。

## 规模 / 影响

- **Tiny**:`file-tree.tsx`(~10 行)+ `session-side-panel.tsx`(1 prop)+ 3 i18n 行,全 fork-only / 加 FORK marker。
- **回退**:`git revert` 本 commit;恢复后收起功能仍在,只是回到"无提示"。
- **0 改上游产品逻辑 / 0 R4 / 0 黑名单**。
