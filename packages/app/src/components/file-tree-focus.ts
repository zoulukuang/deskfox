// [fork-only] 文件树行重挂后补回焦点 [feat: filetree-shortcut-focus-scope] 2026-08-13
//
// [bug-repro: 点**文件**行后 document.activeElement 又变回 body,键盘作用域随之失效;
//   点**目录**行则正常。2026-08-13 按 CHECKLIST #40 逐项验时实测发现。
//   根因不是「没设焦点」—— handleClick 里确实 row.focus() 了 —— 而是设完之后行被**重挂**:
//   文件被打开 → 该行成为 active 且预览区已开 → 命中 file-tree.tsx 里
//   `inactive={!(local.viewerOpen && local.node.path === local.active)}` 的 Tooltip 包裹分支,
//   DOM 节点被销毁重建(实测「旧节点还在文档里 = false」),焦点随之掉回 body。
//   目录行永远不会成为 active,所以不触发,这正是「只修好一半」的由来。]
//
// 因此补焦点必须发生在**重挂之后**,而不是点击当时。

/**
 * 把焦点补回指定路径的文件树行。
 *
 * **只在焦点已经掉回 body(或压根没有)时才补**:用户点完文件树又主动点了别处(聊天框、
 * 预览区)时,焦点是被有意转移的,抢回来会造成比原 bug 更糟的体验 —— 键盘作用域规则是
 * 「焦点在哪就归谁」,补焦点不能破坏这条规则本身。
 *
 * @returns 是否真的补上了(用于测试与调试,不用于控制流)
 */
export function restoreRowFocus(path: string, doc: Document = document): boolean {
  const active = doc.activeElement
  if (active && active !== doc.body) return false
  // 遍历比对属性值,**不拼选择器** —— 文件名里的引号/反斜杠会让选择器直接抛
  // "not a valid selector"(测试里真撞到了),而 CSS.escape 并非哪里都有。
  const row = Array.from(doc.querySelectorAll("[data-tree-path]")).find(
    (el) => el.getAttribute("data-tree-path") === path,
  )
  if (!row || typeof (row as HTMLElement).focus !== "function") return false
  ;(row as HTMLElement).focus({ preventScroll: true })
  return doc.activeElement === row
}
