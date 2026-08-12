// [fork-only] 窄窗口自动收起右侧项目侧栏 —— 判定逻辑(纯函数,可单测)
// [feat: narrow-window-auto-collapse] 2026-08-12
//
// ## 问题
//
// 经典布局五栏容器的两个子项(聊天区 / 侧面板)都是固定宽度,总宽超出可用宽度时会溢出。
// 2026-08-12 实测 1280 宽窗口:可用 770,聊天区 570 + 文件树 240 = 810,溢出 40px;
// **一旦再打开文件预览,预览区会被挤到约 80px,文字竖排成一列完全不可读**。
// 窗口拉到 1475 宽则一切正常(侧面板 515 = 文件树 240 + 预览 275,聊天区自适应 450,无溢出)。
//
// ## 为什么收右侧项目侧栏,而不是压缩聊天区
//
// 右侧侧栏是「项目 / 会话导航」,属于用完即走的入口;而文件树、预览、聊天三者都是当前正在用的。
// 收起它能一次性释放数百 px(实测该栏 445px),把溢出直接消掉,而不是在三个都在用的区域之间拆东墙补西墙。
// 另一个更重要的理由:聊天区宽度是**用户可拖拽且有记忆**的,改它的伸缩规则会破坏既有手感。
//
// ## 迟滞(hysteresis)
//
// 收起后溢出消失,若立刻按「不溢出」判定恢复,就会 收起→恢复→又溢出→再收起 无限抖动。
// 故恢复条件要求**富余空间 ≥ 侧栏宽度 + 余量**,即恢复之后仍有余量不溢出,才真的恢复。

export type SidebarAutoAction = "collapse" | "restore" | "keep"

export interface AutoCollapseInput {
  /** 五栏容器 scrollWidth - clientWidth。> 0 = 正在溢出;< 0 = 有富余(绝对值即富余量) */
  overflowPx: number
  /** 右侧项目侧栏当前是否展开 */
  sidebarOpen: boolean
  /** 右侧项目侧栏宽度(px) */
  sidebarWidth: number
  /** 当前的收起状态是否由本机制自动做出的(用户手动收起的不归我们管、也不自动恢复) */
  autoCollapsed: boolean
  /** 迟滞余量,默认 48px */
  restoreMarginPx?: number
}

const DEFAULT_RESTORE_MARGIN = 48

/**
 * 决定对右侧项目侧栏做什么。
 *
 * - `collapse`:正在溢出且侧栏开着 → 自动收起(并记 autoCollapsed)
 * - `restore` :之前是我们自动收的,且现在恢复回去也不会溢出(留足余量)→ 恢复
 * - `keep`    :其余一律不动 —— 尤其是**用户自己收起的**(autoCollapsed=false 且 sidebarOpen=false),
 *              绝不擅自替用户打开
 */
export function decideSidebarAutoCollapse(input: AutoCollapseInput): SidebarAutoAction {
  const margin = input.restoreMarginPx ?? DEFAULT_RESTORE_MARGIN

  if (input.sidebarOpen) {
    // 开着 + 正在溢出 → 收起。已经是 autoCollapsed 但侧栏又开着,说明用户手动开了回来,
    // 此时仍然收起会打架 —— 交给调用方在用户手动操作时清掉 autoCollapsed 标志。
    if (input.overflowPx > 0 && !input.autoCollapsed) return "collapse"
    return "keep"
  }

  // 侧栏是收起状态:只有「我们自动收的」才考虑恢复
  if (!input.autoCollapsed) return "keep"

  // overflowPx < 0 表示富余;恢复后要多占 sidebarWidth,故需富余 ≥ sidebarWidth + margin
  const spare = -input.overflowPx
  if (spare >= input.sidebarWidth + margin) return "restore"
  return "keep"
}
