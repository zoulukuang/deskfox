// [fork-only] 文件树宽度的唯一事实源 [feat: file-tree-width-single-source] 2026-08-13
//
// ## 为什么要抽出来
//
// 上游本次 sync(v1.17.4 → v1.18.16)给**侧面板**加了最小宽度约束:
//   fileTreeWidth = Math.max(FILE_TREE_WIDTH_MIN, layout.fileTree.width())
// 却**没有同步更新聊天区**的宽度计算,后者仍用裸值:
//   sessionPanelWidth = `calc(100% - ${layout.fileTree.width()}px)`
//
// 于是当存储宽度小于最小值时(实测 存储 200 / 最小 240),两处各算各的:
//   侧面板实际占 240,聊天区却按 200 让位 → **聊天区恒定溢出 40px**。
// 溢出部分被右侧会话面板(绝对定位、层级更高)盖住,后果是**功能按钮点不到**:
//   user 2026-08-13 反馈「查找框没有关闭按钮了,只能用快捷键关」「会话『更多』按钮没显示全」。
// 实测(viewport 1600):main 右缘 1155,查找框右缘 1179,「关闭」按钮 x=1150~1174 —— 19px 在遮挡区内。
//
// 基准版 e77443750e 没有这个 clamp,两处都用裸值、天然一致,所以不溢出 —— **本缺陷是本次 sync 引入的回归**。
//
// ## 为什么抽成函数而不是就地补一个 Math.max
//
// 就地补只能修好今天这一处;两个地方各写各的计算,下次上游再动其中一处,同样的偏差会再来一遍。
// 抽成唯一事实源后,任何一处改动都自动作用于两边 —— 这是结构性防复发,不是打补丁。

/** 文件树最小宽度。低于此值时,面板实际占位仍是这个值。 */
export const FILE_TREE_WIDTH_MIN = 240

/**
 * 文件树的**实际占位宽度** —— 侧面板渲染宽度与聊天区让位宽度必须**同取此值**,
 * 否则两者不一致就会溢出(见文件头)。
 */
export function resolvedFileTreeWidth(storedWidth: number): number {
  return Math.max(FILE_TREE_WIDTH_MIN, storedWidth)
}
