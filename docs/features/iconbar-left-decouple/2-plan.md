feat-id: iconbar-left-decouple
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 2-plan — 实施计划 + 决策轨迹

## note 0 — 范围/代价的知情确认(动工前)
读透 `sidebar-project.tsx` 后发现真实范围比底稿(REQ-041)估的「80-150 行 2 文件」大不少:实为 **Large**——5 文件 + 删 `aim.ts` + 改 context 接口,且**深改 opencode 上游骨架**(`layout.tsx`/`sidebar-project.tsx`/`aim.ts` 都是上游文件,删上游 hover/aim/预览机制会增加未来升级合并的冲突面)。已把这个战略代价 + 「悬停预览其实有两套」明确同步 user,user 拍板「确认开干」+「点图标只切项目不动开合」。

## 实施顺序(叶子 → 根,减少中间破坏)
1. `sidebar-shell.tsx` 重写:抽 `SidebarRail`(图标条)+ `SidebarContent` 改为 mobile-only 合并版(接 rail element)+ 删 aimMove + placement 回 right。
2. `sidebar-project.tsx` 重写:删 HoverCard/ProjectPreviewPanel + 点击改 navigateToProject + 精简 `ProjectSidebarContext`。
3. 删 `aim.ts`(`git rm`)。
4. `layout.tsx` 大改:删 aim/hover/peek state 机 + 改 ctx + 布局重排(图标条 left-0 / 会话面板 right-0 / main 夹中间)+ 删 peek 渲染。
5. typecheck → build → CDP 验 DOM → user 真桌面 QA。
6. 文档 + 测试 + commit(REQ-040 基线已先 commit `a24ff35a0`,本笔为第二 commit)。

## note 1 — 策略:删机制、保跨文件 context 签名
`sidebarHovering`/`clearHoverProjectSoon` 被 `sidebar-workspace.tsx`+`sidebar-items.tsx` 广泛消费。为不连锁改那两个文件的接口/组件,**保留这两个 context 字段签名但传恒定**(`()=>false`/`()=>{}`,注释标 REQ-041 禁用)。`sidebar-project.tsx` 是自闭环(我读全了),直接删字段。`sidebarExpanded` 简化为 `=opened`。遗留死字段记 backlog(未来彻底清理 context)。

## note 2 — 布局坐标推导
- 图标条:`absolute inset-y-0 left-0 w-16`(64px 固定)。
- 会话面板:`absolute inset-y-0 right-0`,外层折叠容器 `width = opened ? panel() : 0` + `overflow-hidden`,内层 `@container` 固定 `panel()` 宽 → 收起时内容被裁切(滑出动画)。`panel() = side()-64`。
- main:`left-16`(固定让出图标条 64)+ `right=[var(--main-right)]`(opened→`panel()` / 收起→`0`);过渡 `transition-[right]`。main 右缘 = `panel()` = 会话面板左缘,对齐无重叠。
- resize 手柄:`right: panel()`(会话面板左缘),`edge="start"`(拖左变宽),`size=sidebar.width()`。
- **撤销 REQ-040 镜像**:图标条回左后,main 边框/圆角回 `xl:border-l xl:rounded-tl`、顶部辅助条回 `right-0 + left:calc(4rem+12px)`、SidebarPanel merged 回 `border-l rounded-tl`(会话面板左缘接 main)。

## note 3 — 顶部 sidebar.toggle 按钮零改动
`titlebar.tsx:214` 那个按钮已经是 `onClick={layout.sidebar.toggle}` + 独立。user 要的「开合只归它」本就成立,本次不碰。

## note 4 — 删两套预览的确认
① layout 的 peek 面板(会话栏关时悬停弹)② `sidebar-project.tsx` HoverCard「最近会话卡」(会话栏开时悬停非当前项目弹)。两套都删。`aim.ts` 只为①防误切服务 → 一并整删。
