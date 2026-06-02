feat-id: iconbar-left-decouple
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

## 改动概览
五栏布局从镜像版(REQ-040)推进到理想版:`图标条│会话列表│聊天│审查│文件树` →（镜像）→ `文件树│审查│聊天│会话列表│图标条` →（本笔 REQ-041）→ **`图标条│文件树│审查│聊天│会话列表`**。核心是 user 拍板的「彻底解耦」:删掉图标条↔会话栏之间的 hover 预览/鼠标瞄准/折叠耦合,三块各司其职。

**净删 507 行**(+161 / -668)—— 减法重构,架构更纯粹。0 改后端 / 深改 4 个上游文件(R1 走「必须深改」分支,见 1-spec ⚠ + 2-plan note 0)。

## 文件级改动(4 文件,净 -507 行)

| 文件 | Δ | 改动 |
|---|---|---|
| `layout.tsx` | 268(大量删) | 删 aim/hover/peek 状态机(`hoverProject`/`peek`/`arm`/`disarm`/`navLeave`/`hoverProjectData`/`peekProject`/相关 effect)+ 删 peek 面板/阴影渲染 + 拆 nav 为图标条(`left-0 w-16`)/会话面板(`right-0` 可折叠)/main(`left-16` + `right=[--main-right]`)+ 撤销 REQ-040 镜像(border/圆角回左)+ 精简两个 sidebar context |
| `sidebar-project.tsx` | 253(大量删) | 删 HoverCard 预览 + 整个 `ProjectPreviewPanel` 组件 + `overlay`/`preview`/`isHoverProject`/`hoverOpen` 逻辑;点图标只 `navigateToProject`(删「点已选中→toggle」);`ProjectSidebarContext` 删全部 hover 字段 |
| `sidebar-shell.tsx` | 170 | 抽独立 `SidebarRail`(图标条)组件;`SidebarContent` 改为 mobile-only(接 rail element + renderPanel);删 `aimMove`;tooltip placement 回 `right` |
| `aim.ts` | -138 | **整个文件删除**(鼠标瞄准三角预测,只为 peek 防误切服务) |

## UI 位置微调(user 看 REQ-041 时连续提的,同主题并入)
| 文件 | 改动 |
|---|---|
| `titlebar.tsx` | 顶部两组互换:工具组(文件夹/终端/导入等,原右)→ 左上挨文件树侧;侧栏切换+前进后退导航(原左)→ 右上挨会话栏侧 |
| `session-side-panel.tsx` | 文件树 tab 顺序对调:[所有文件] 在左、[N 更改] 在右 |
| `session-header.tsx` | titlebar 工具组内互换:文件树开关 → 最左、项目「打开」下拉 → 最右 |
| `layout.tsx` | e2e-mock 模式不渲染 dev 性能浮层 DebugBar(聊天移右后输入框靠右下,与 fixed 右下的 DebugBar 几何重叠致 e2e 点不到;release 无 DebugBar 不受影响)|

## 保留签名置空(控制连锁,不改 sidebar-workspace/sidebar-items)
`workspaceSidebarCtx` / `sessionProps` 的 `sidebarHovering`→`()=>false`、`clearHoverProjectSoon`→`()=>{}`、`sidebarExpanded`→`=opened`。死字段清理留 backlog。

## 验证(R8 结构层全过)
- **T1 typecheck**:17/17 pass ✅(`@opencode-ai/app` 全新执行,验删除无悬空引用 + 接口一致)
- **T2 单测**:packages/app 780 pass / 0 fail ✅(删的预览/aim 无单测覆盖,删除未破坏断言)
- **T3 Phase 1 e2e**:14 passed / 3 skipped / 0 fail ✅(修了 1 个回归:聊天移右后 prompt-input 与 dev DebugBar 浮层重叠 → e2e-mock 隐藏 DebugBar)
- **T4 桌面五栏 DOM 顺序(CDP)**:✅ 图标条(l=0,w=64)│ 文件树/审查(main 左)│ 聊天(main 右)│ 会话面板(最右,展开 w=252/收起 0)
- **T5 release build**:DeskFox.exe 产出 + 启动正常 ✅(CDP 截图无错乱)
- **T8 顶部按钮开合(CDP)**:✅ 点顶部 sidebar 图标,会话栏 0↔252、main 同步
- **T6/T7/T9/T10 交互·视觉·native**:user 真桌面 QA 进行中(悬停无预览 / 点图标只切项目 / resize / 边框圆角 / 移动端 + titlebar 互换观感)

## commit
- 基线 REQ-040 镜像版:`a24ff35a0`
- REQ-041 + UI 微调:grep `[feat: iconbar-left-decouple]`(本系列,拆 2 笔:核心解耦 / UI 位置微调)

## 回退方法
`git revert <本笔 commit>` 回到镜像版(REQ-040);再 revert `a24ff35a0` 回原始开发者布局。两笔各自独立可逆(P4)。注:本笔删了 `aim.ts` + 上游 hover 机制,revert 会原样恢复。

## 遗留 backlog
- `WorkspaceSidebarContext` / `SessionItemProps` 的 `sidebarHovering`/`clearHoverProjectSoon` 死字段彻底清理(本次为控连锁保留)。
- 上游 merge 时这 4 个文件冲突面增大,需在 UPSTREAM-MERGE-GUIDE 留意。
