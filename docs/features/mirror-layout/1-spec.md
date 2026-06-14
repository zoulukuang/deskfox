feat-id: mirror-layout
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 界面镜像翻转 — 五栏整体左右对调(REQ-040)

> 规模:Medium(纯前端,~40-80 行,3 文件 + 1 共享组件 edge 行为复用)
> 决策底稿:`OPENCODE-PLAN/需求池/界面镜像翻转-布局左右对调.md`(调研 + 备选方案存档)

## 一、需求与动机

DeskFox 定位白领 / 非开发者用户。这类用户心智:文件 / 内容在**左**、操作区在右(类资源管理器 / Word 导航窗格)。当前 DeskFox 是开发者 IDE 式布局——文件树 / 审查在最右,会话列表在左二。本需求把整体镜像翻转,让"文件 / 改动区"靠左、"聊天"靠右。

### 当前布局(左 → 右)

```
图标活动栏 │ 会话列表 │ 聊天主区 │ 审查 │ 文件树
```

### 目标布局(纯镜像翻转,便宜版)

```
文件树 │ 审查 │ 聊天主区 │ 会话列表 │ 图标活动栏
```

与用户原诉求(图标栏锚定最左、其余翻转)的**唯一差异**:图标活动栏落**最右**而非最左。其余 4 栏相对顺序与原诉求完全一致。用户已接受此差异(完整重排成本是镜像版一个数量级以上,见底稿 §五 存档)。

### 明确不做
- **不**砍审查 / 更改面板(同一份 `reviewDiffs` 数据两视图,snapshot 回滚安全命根子)
- **不**碰后端 git / snapshot / 文件监听。纯前端 UI 翻转。

## 二、架构选型:机械翻转,不动架构

当前 5 栏物理上是 **3 个封装单元**:`(图标条+会话列表)` / `聊天` / `(审查+文件树)`。镜像 = 3 个单元各自整体平移 + 内部各自翻面,**没有一处需要提升状态 / 抽组件 / 跨组件传数据**。

两个关键确认让它便宜:
- **ResizeHandle** 自带 `edge: "start" | "end"` prop(`packages/ui/src/components/resize-handle.tsx:5`),CSS 按 `data-edge` 切 `inset-inline-start/end` + 翻转拖拽 delta 符号;翻锚定边只传一个值,不改逻辑。
- 侧栏 `nav` 内部 = `[图标条 w-16][会话面板 flex-1]` 的 flex 行;`flex-row-reverse` 整体翻面,图标条 / 会话列表都不用拆。

**坑(底稿 §四)**:Tailwind 用物理方向类(`left-`/`right-`)非逻辑类(`start-`/`end-`),`dir="rtl"` 一键翻在这里**不生效**,只能逐处手翻。

## 三、改动清单(机械 `left↔right` / `border-l↔r` / `rounded-tl↔tr` / `flex-row↔reverse` / resize edge / `translate-x` 符号)

| 文件 | 改动 |
|---|---|
| `layout.tsx` | 侧栏 nav `left-0`→`right-0`;sidebar resize 包裹层 `left`→`right` style + 手柄 `edge="start"`;顶部边框辅助条 `right-0`→`left-0` + style `left`→`right`;main 容器 `xl:right-0 xl:left-[var]`→`xl:left-0 xl:right-[var]` + 过渡属性 `left`→`right`;main 边框 `xl:border-l rounded-tl`→`border-r rounded-tr`;peek 面板 `left-16`→`right-16` + 滑入 `-translate-x-2`→`translate-x-2`;peek 阴影缝 `right-0`→`left-0` + style `left`→`right`;SidebarPanel `rounded-tl border-l`→`rounded-tr border-r` |
| `layout/sidebar-shell.tsx` | 容器加 `flex-row-reverse`;tooltip placement `"right"`→`"left"` |
| `session.tsx` | 聊天+侧面板容器 `md:flex-row`→`md:flex-row-reverse`;聊天 ResizeHandle 加 `edge="start"` |
| `session/session-side-panel.tsx` | 审查/文件树容器加 `flex-row-reverse` + 分隔 `border-l`→`border-r`(:277);文件树 inner 分隔 `border-l`→`border-r`(:432);文件树 ResizeHandle `edge="start"`→`edge="end"` |

### 对底稿清单的一处主动偏离(已分析)
- 底稿列出 `session-side-panel.tsx:344` tab 工具条 `sticky right-0`→`sticky left-0`。**本次不改**:该 `+` 开文件按钮是横向滚动 tab 条的**最后一个 flex 子元素**,`sticky right-0` 是让它在 tab 溢出时钉在右端可见。tab 条属"栏内内容"(tab 仍 L→R 阅读),不是栏边界;翻成 `left-0` 会让按钮滚动时盖住最左侧的 tab(它仍是最后一个子元素,没同步移到最前)。镜像栏顺序不应反转栏内文字 / tab 方向。留 `right-0`,视觉 QA 复核。

## 四、验收标准

1. 桌面(`xl:`)下五栏左→右顺序:文件树 / 审查 / 聊天 / 会话列表 / 图标条
2. 三处 ResizeHandle(侧栏 / 聊天 / 文件树)抓取边跟手、方向正确(拖动变宽方向对)
3. 圆角 / 边框接缝无漏翻导致的缝或重影
4. peek 项目预览入场动画方向 + 阴影方向自然
5. 移动端(< xl)布局不回归(flex-col 不受 `md:flex-row-reverse` 影响,移动侧栏 `translate-x` 滑入照旧)
6. typecheck 全绿 / 既有单测 + e2e 无回归

## 五、R8 测试用例清单(动工前定,逐条可勾选)

> 区分:**结构层**(DOM 栏顺序 / class)可 CDP/e2e 断言;**视觉层 + native** 必须真桌面人眼抽查(对照 memory `CDP 自测 ≠ 真桌面 QA`)。

| # | 用例 | 层级 | 预期 | 验证手段 |
|---|---|---|---|---|
| T1 | typecheck | 结构 | `@opencode-ai/app` 编译过(验所有 JSX 注释 / class 改动语法正确) | `bun run typecheck` |
| T2 | 既有 app 单测无回归 | 结构 | packages/app 单测全绿(纯 class/order 改动不应动断言) | `bun test`(app 包) |
| T3 | 既有 Phase 1 e2e 无回归 | 结构 | mock e2e 11 pass(布局翻转不破坏聊天主循环) | vite e2e-mock + playwright |
| T4 | 桌面五栏 DOM 顺序 | 结构 | CDP 取 `[data-component]` / aside 顺序 = 文件树→审查→聊天→会话列表→图标条 | CDP 自测(release exe) |
| T5 | release exe 能 build + 启动 | 运行时·native | DeskFox.exe 产出且能启动到主界面(验 bundle 无 break) | build-deskfox.ps1 -Env dev |
| T6 ⚠ | 三处 resize 手柄抓取边 + 拖拽方向 | 视觉·native | 侧栏/聊天/文件树各自抓边在正确一侧、拖动变宽方向对 | 真桌面人眼 |
| T7 ⚠ | 圆角/边框接缝 | 视觉 | border-l↔r / rounded-tl↔tr 无漏翻缝隙 / 重影 | 真桌面人眼 |
| T8 ⚠ | peek 项目预览动画 + 阴影 | 视觉·native | hover 项目图标,预览从右侧滑入、阴影方向自然 | 真桌面人眼 |
| T9 ⚠ | 移动端断点切换 | 视觉·native | 窗口缩到 < xl,布局退回单列、移动侧栏滑入正常 | 真桌面人眼 |
| T10 ⚠ | tab 工具条 `+` 按钮(§三偏离项) | 视觉 | 保留 `sticky right-0`,tab 溢出时 `+` 钉右端不盖 tab | 真桌面人眼 |

⚠ = 必须真桌面 QA,CDP/e2e 无法替代。

## 六、退出条件
实施 + T1-T5 结构验证通过 + user 真桌面 QA(T6-T10)通过;或 user 改主意要图标栏在左(转底稿 §五 贵方案,本 feat 关闭)。
