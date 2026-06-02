feat-id: iconbar-left-decouple
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 界面完整重排 — 图标栏锚左 + 彻底解耦(REQ-041)

> 规模:**Large**(触动 5 个上游文件 + 删一个上游算法文件 + 改 context 接口)
> 前置:REQ-040 镜像版(`feat/mirror-layout` 分支 commit `a24ff35a0`,本 feat 的中间基线)
> 决策底稿:`OPENCODE-PLAN/需求池/界面完整重排-理想五栏布局.md`(REQ-041)
> ⚠️ **深改 opencode 上游骨架**:`layout.tsx` / `sidebar-project.tsx` / `aim.ts` 都是上游文件,本次删除上游的「悬停预览 + 鼠标瞄准 + 图标控折叠」机制并拆分侧栏骨架 —— 未来跟上游升级合并这块会增加冲突面,user 已知情确认(成本/代价讨论见 2-plan note 0)。

## 一、目标布局

```
图标活动栏 │ 文件树 │ 审查 │ 聊天主区 │ 会话列表
   [1]       [2]     [3]      [4]        [5]
```

这是 user 最初标注的「理想布局」:图标栏锚最左(主流 IDE/应用习惯),文件/内容区靠左,聊天/会话靠右。是 REQ-040 镜像版(图标栏被甩到最右)的增量后续。

## 二、核心决策:user 拍板的「彻底解耦」(而非「跨 main 重新布线」)

调研发现:从镜像版到理想版,文档原方案要把「图标条+会话列表」焊死组合劈开后,**把它俩之间的 hover 预览 / 鼠标瞄准 / 自动折叠 状态机跨整个 main 重新布线** —— 这是最大技术风险。

**user 的洞察(2026-06-02)**:与其重新布线,不如**直接砍掉这套耦合**,让三块各司其职、完全隔离:

| 部件 | 唯一职责 | 联动 |
|---|---|---|
| 图标竖栏(最左 64px) | 切换项目 | **谁都不联动** |
| 会话列表(最右) | 列当前项目会话 | 只听顶部 sidebar.toggle 按钮 |
| 顶部小图标按钮(已存在) | 开/合会话列表 | 独立(`titlebar.tsx`,已是 `layout.sidebar.toggle`)|

**user 明确拍板的两条交互**:
1. 鼠标悬停图标栏项目 → **不弹任何会话预览**(删两套预览)。
2. 点图标栏项目 → **只切项目,绝不开合会话栏**(删「点已选中项目→toggle」)。

「删」比「重新布线」更便宜、更安全、架构更纯粹(单一职责)。

## 三、要删 / 改的清单

### 删除(机制)
- **两套悬停预览**:① 会话栏关时 layout 的 peek 面板 + 阴影;② 会话栏开时 `sidebar-project.tsx` 的 HoverCard + 整个 `ProjectPreviewPanel` 组件。
- **`aim.ts`**:鼠标瞄准三角预测算法,**整个文件删除**(它只为预览防误切服务)。
- **layout 状态机**:`hoverProject`/`peek`/`peeked` state、`arm`/`disarm`/`navLeave`、`setHoverProject`/`hoverProjectData`/`peekProject`/相关 effect。
- **图标点击 toggle**:`ProjectTile` onClick 删「点已选中→`sidebar.toggle`」,改只 `navigateToProject`。
- **nav 的 hover 事件接线**:`onMouseEnter`/`onMouseLeave`(arm/disarm)。

### 拆分(布局)
- **图标条**:从 `SidebarContent` 抽成独立 `SidebarRail` 组件;桌面端由 layout 绝对定位 `left-0 w-16`(最左固定 64px)。
- **会话面板**:layout 绝对定位 `right-0`,`width = opened ? panel() : 0`(收起滑出);只由 `sidebar.toggle` 驱动。
- **main**:`left-16`(固定让出图标条)+ `right=[var(--main-right)]`(opened 时 `panel()`,收起 `0`);边框/圆角回原始 `border-l rounded-tl`(撤销 REQ-040 镜像)。
- **resize 手柄**:重锚到会话面板左缘(`right: panel()`)。
- **移动端**:抽屉保持合并版(`SidebarContent` rail+panel 横排,经 `mobileSidebarContent`)。

### 保留签名、置空(控制连锁)
- `WorkspaceSidebarContext` 的 `sidebarHovering`/`clearHoverProjectSoon` 仍被 `sidebar-workspace.tsx`/`sidebar-items.tsx` 引用 → 保留字段但传 `()=>false`/`()=>{}`(注释标 REQ-041 禁用),不连锁改那两个文件接口。`sidebarExpanded` 简化为 `=opened`。

### 不碰
`session.tsx`(REQ-040 已正序)、文件树(不提层)、`session-side-panel.tsx`、后端 git/snapshot/监听、顶部 sidebar.toggle 按钮(已独立)。

## 四、验收标准
1. 桌面五栏左→右:图标条 / 文件树 / 审查 / 聊天 / 会话列表
2. 悬停图标栏项目 **不弹**任何会话预览
3. 点图标栏项目**只切项目**,会话栏开合状态不变
4. 会话栏开合**只**响应顶部 sidebar.toggle 按钮;开合有平滑滑入/滑出
5. 三处 resize(无侧栏图标 resize / 会话面板 / 聊天 / 文件树)抓取边 + 方向正确
6. 圆角/边框接缝无缝/无重影;移动端抽屉不回归
7. typecheck 全绿 + 既有测试无回归

## 五、R8 测试用例清单(动工前定)

> 结构层可 CDP/e2e 断言;视觉+交互+native 必须真桌面人眼/动手(对照 memory `CDP 自测 ≠ 真桌面 QA`)。

| # | 用例 | 层级 | 预期 | 手段 |
|---|---|---|---|---|
| T1 | typecheck | 结构 | 17/17 pass(验删除无悬空引用 + 接口一致) | `bun run typecheck` ✅ |
| T2 | 既有 app 单测无回归 | 结构 | packages/app 单测全绿 | `bun test` |
| T3 | 既有 Phase 1 e2e 无回归 | 结构 | mock e2e 11 pass | playwright |
| T4 | 桌面五栏 DOM 顺序 | 结构 | CDP:`[data-component=sidebar-nav-desktop]`(图标条)在最左、`sidebar-session-panel` 在最右、main 居中 | CDP 自测 |
| T5 | release exe build + 启动 | 运行时·native | DeskFox.exe 产出且启动到主界面 | build-deskfox.ps1 |
| T6 ⚠ | 悬停图标项目无预览 | 交互·native | 鼠标停在图标栏任意项目,**不弹**会话卡片/peek | 真桌面动手 |
| T7 ⚠ | 点图标只切项目 | 交互·native | 点未选中项目→切过去;点已选中项目→无反应;**全程会话栏开合不变** | 真桌面动手 |
| T8 ⚠ | 顶部按钮开合会话栏 | 交互·native | 点顶部 sidebar 图标→会话栏滑入/滑出;键盘快捷键同效 | 真桌面动手 |
| T9 ⚠ | 三处 resize 抓取边+方向 | 交互·native | 会话面板/聊天/文件树各自抓边正确、拖动变宽方向对 | 真桌面动手 |
| T10 ⚠ | 边框/圆角接缝 + 移动端 | 视觉·native | main 左上圆角/边框无缝;窗口缩到 <xl 抽屉正常 | 真桌面人眼 |

⚠ = 必须真桌面,CDP/e2e 无法替代。

## 六、退出条件
实施 + T1–T5 结构验证 + user 真桌面 QA(T6–T10);或 user 改主意回镜像版/原版(则本 feat 关闭)。
