feat-id: mirror-layout
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划 + 决策轨迹

## 实施顺序
1. 先读全部 4 个文件的真实当前行号(主分支远端有推进,底稿行号可能漂移)→ 确认每处 class/style 的精确上下文
2. 按文件逐处机械翻转(layout.tsx → sidebar-shell.tsx → session.tsx → session-side-panel.tsx)
3. `bun run typecheck`(T1)
4. build release exe(T5)+ CDP 自测 DOM 栏顺序(T4)
5. 填 3-changelog + 更新 INDEX
6. 向 user 报告,请求真桌面 QA(T6-T10),**不自动 merge / push**

## 决策轨迹(实时追加)

### note 1 — FORK marker 在 JSX 里的放置坑(实施期踩坑)
R2 要求改上游文件加 `// FORK:` marker。但 JSX **不允许在开标签的两个 attribute 之间插 `//` 行注释或 `{/* */}`**(解析报错)。正确放法:
- class/classList/style 的**对象字面量内部** → 用 `// FORK:`(JS 对象表达式,合法)
- JSX 子元素位置(元素之间)→ 用 `{/* FORK: */}`
- `return (` 之后、元素之前(表达式位置)→ 用纯 `/* FORK: */`(无大括号)
首版误把 marker 放在 attribute 之间,typecheck 前自查纠正了 3 处(layout resize 包裹层 / sidebar-shell 容器 / session-side-panel classList)。

### note 2 — ResizeHandle edge 三处的方向推导
CSS(`resize-handle.css`)horizontal 默认 `inset-inline-end:0`(贴父右缘),`data-edge="start"` → `inset-inline-start:0`(贴左缘);JS drag delta:edge start = `start-pos`(向左拖变宽),否则 `pos-start`(向右拖变宽)。三处推导:
- **侧栏**(layout):原默认 end(侧栏在左,手柄在右缘,右拖变宽)→ 翻后侧栏在右,手柄应在**左缘** + 左拖变宽 → 加 `edge="start"`
- **聊天**(session):原默认 end(聊天在左,右缘)→ 翻后聊天在右,手柄在左缘 → 加 `edge="start"`
- **文件树**(side-panel):原 `edge="start"`(文件树在右,手柄在左缘)→ 翻后文件树在左,手柄应在**右缘** → 改 `edge="end"`
均与 CSS + drag 逻辑双向对账确认。

### note 3 — 主区过渡属性必须同步翻
main 容器原 `xl:right-0 xl:left-[var(--main-left)]` + `transition-[left] will-change-[left]`(侧栏开合时 main-left 在 `side()px`↔`4rem` 间变,动画 `left`)。翻成 `xl:left-0 xl:right-[var(--main-left)]` 后,变化的是 `right`,**过渡属性必须一起改 `transition-[right] will-change-[right]`**,否则动画不生效变生硬。`--main-left` 变量名保留不改(底稿许可)。

### note 4 — 对底稿 §344 sticky 的偏离
见 1-spec §三偏离段:`+` 开文件按钮是横向滚动 tab 条的最后子元素,`sticky right-0` 翻 `left-0` 会盖左侧 tab。判定为"栏内内容"非栏边界,不翻,留 QA 复核。这是与底稿清单的唯一主动偏离。
