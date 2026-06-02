feat-id: mirror-layout
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

## 改动概览
纯前端镜像翻转,5 栏布局左右对调:`图标条│会话列表│聊天│审查│文件树` → `文件树│审查│聊天│会话列表│图标条`。0 改后端 / 0 改上游(全在 fork 自有的 app 页面文件)/ 0 R4。

## 文件级改动(4 文件,~+41 / -20 行)

### `packages/app/src/pages/layout.tsx`(+13 处区域)
- SidebarPanel(会话面板)`rounded-tl-[12px]`→`rounded-tr`、`border-l`→`border-r`(merged 态接缝翻右)
- 侧栏 nav `absolute inset-y-0 left-0`→`right-0`(整条侧栏平移到最右)
- 侧栏 ResizeHandle 包裹层 `style.left`→`style.right`、手柄加 `edge="start"`(锚定左边界 + 左拖变宽)
- 顶部边框辅助条 `right-0`→`left-0`、`style.left`→`style.right`
- 主区容器 `xl:right-0 xl:left-[var(--main-left)]`→`xl:left-0 xl:right-[var(--main-left)]`,过渡 `transition/will-change-[left]`→`[right]`(变量名保留)
- 主区 `<main>` 边框 `xl:border-l xl:rounded-tl`→`xl:border-r xl:rounded-tr`
- peek 项目预览面板 `left-16`→`right-16`、隐藏态 `-translate-x-2`→`translate-x-2`(从右滑入)
- peek 阴影缝 `right-0`→`left-0`、`style.left`→`style.right`、隐藏态 `-translate-x-2`→`translate-x-2`

### `packages/app/src/pages/layout/sidebar-shell.tsx`(2 处)
- tooltip `placement` `"right"`→`"left"`(图标条到屏幕右缘,tooltip 朝左避免被截)
- 容器加 `flex-row-reverse`(图标条↔会话面板内部对调,图标条落最右)

### `packages/app/src/pages/session.tsx`(2 处)
- 聊天+侧面板容器 `md:flex-row`→`md:flex-row-reverse`(聊天↔审查/文件树整体对调)
- 聊天 ResizeHandle 加 `edge="start"`(聊天靠右,手柄锚定左边界)

### `packages/app/src/pages/session/session-side-panel.tsx`(3 处)
- 审查/文件树容器加 `flex-row-reverse` + 分隔 `border-l`→`border-r`(文件树落最左)
- 文件树 inner 容器分隔 `border-l`→`border-r`
- 文件树 ResizeHandle `edge="start"`→`edge="end"`(文件树靠左,手柄锚定右边界)

## 与底稿(REQ-040)清单的偏离
- 底稿 `session-side-panel.tsx:344` 的 `sticky right-0`→`left-0`:**未改**。该 `+` 按钮是横向滚动 tab 条最后子元素,翻 `left-0` 会滚动时盖左侧 tab。判为栏内内容非栏边界,留 `right-0`。详见 1-spec §三 / 2-plan note 4。

## FORK marker 放置(R2)
所有 marker 放在 class/style 对象字面量内部(`// FORK`)、JSX 子元素位置(`{/* FORK */}`)或 `return(` 后表达式位置(`/* FORK */`)。**不放 attribute 之间**(JSX 解析报错,首版踩坑已纠,详 2-plan note 1)。

## 验证
- T1 typecheck:`bun run typecheck` 17/17 pass(`@opencode-ai/app` 全新执行,验证所有 JSX 注释/class 语法)✅
- T5 release build:`build-deskfox.ps1 -Env dev -NoBundle` → DeskFox.exe 产出 ✅(见下)
- T4 桌面五栏 DOM 顺序:CDP 自测 <待填>
- T2/T3 单测 + e2e 无回归:<待填>
- T6-T10 视觉/native:**待 user 真桌面 QA**

## commit
<待填>

## 回退方法
`git revert <commit>`(P4 单 commit 单事,纯 class/order 翻转,无状态/数据迁移,可干净回退)。
