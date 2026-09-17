// FORK-ONLY: REQ-111 点顶部当前文件 tab 收起预览器(判定纯逻辑)
// [feat: session-presentation-input-batch] 2026-08-17
//
// 背景:2026-06-04 的 filetree-toggle(再次点击正在查看的文件 → 收起面板)在 2026-08-11 sync 时
// 被加了 `!newLayoutDesigns()` 条件 → v2 布局下整条失效,而 tooltip「点击收起预览」照常弹出,
// 提示与行为脱节。user 2026-08-15 确认原版支持「点 tab 收起」,本条按恢复处理。
//
// 实现上**不复刻**基准版那条依赖 Kobalte `onChange` 对同值点击隐式行为的链路
// (本批四条回归里已有三条就是这么悄悄丢的),改用 Trigger 上的显式判定 —— 即本文件。
//
// 两个必须绕开的坑:
//   ① **点的是不是「已激活的那个」要在按下的最早时机判**:Kobalte 的 Tabs.Trigger 在
//      **pointerdown** 就把该 tab 切成激活,click 处理器里再读 activeTab 已经是新值
//      → 每次切 tab 都被误判成「再次点击」,面板当场被收掉。
//      ⚠️ mousedown 也**不够早**(pointerdown 先于 mousedown),必须用**捕获阶段的 pointerdown**
//      在外层 wrapper 上抓快照(见 session-sortable-tab{,-v2}.tsx 的 `on:pointerdown` + capture)。
//      这一条是实打实撞出来的:先用 mousedown 写,被上游 file-browser-sidebar-tab-switch e2e 抓到
//      —— 切 tab 后目标 tab 直接消失(面板被收 → 预览 tab 被替换)。
//   ② **v2 的双击语义**:文件树单击 = preview(临时 tab),双击该 tab = 提升为永久。
//      临时 tab 上「单击收起」会与「双击提升」的第一次点击撞车,所以临时 tab 返回 "defer" ——
//      调用方延后一小段再收起,期间若来了 dblclick 就取消。永久 tab 没有双击行为,直接收。
export type TabCollapseDecision = "collapse" | "defer" | "ignore"

export function decideTabCollapse(input: {
  tab: string
  /** mousedown 时刻的激活 tab(不是 click 时刻,见坑 ①) */
  activeAtPress: string | undefined
  /** 预览面板当前是否打开 —— 没开就没有"收起"可言 */
  viewerOpen: boolean
  /** 该 tab 是否为临时(preview)态,见坑 ② */
  isTemporary: boolean
  /** 是否是真实文件 tab(review / context 等非文件 tab 不参与) */
  isFileTab: boolean
  /**
   * FORK: REQ-130 兜底 —— click 时该 tab 是否还在。
   *
   * 点 × 的时序是「× 先把 tab 关掉 → click 再冒泡上来」,所以冒上来时那个 tab 其实已经不存在了。
   * 「点一个已经不存在的 tab」本身就不该触发任何收起判定。
   *
   * 主修法在 session-sortable-tab{,-v2}.tsx(wrapper onClick 认出 × 就 return),那是 DOM 层、
   * 只能 e2e 验;这条是纯逻辑兜底,可单测,且对"× 之外任何把 tab 关掉后仍冒出 click"的路径同样有效。
   * 省略时按 true 处理,老调用方行为不变。
   */
  tabStillExists?: boolean
}): TabCollapseDecision {
  if (input.tabStillExists === false) return "ignore"
  if (!input.isFileTab) return "ignore"
  if (!input.viewerOpen) return "ignore"
  if (input.activeAtPress !== input.tab) return "ignore"
  return input.isTemporary ? "defer" : "collapse"
}

/** 临时 tab 的延后收起窗口:够长到能等到系统双击的第二下,又短到不像卡顿。 */
export const TAB_COLLAPSE_DEFER_MS = 260
