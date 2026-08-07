// FORK-ONLY file: REQ-097 会话内查找 — CSS Custom Highlight 层 [feat: in-session-find]
//
// 用 CSS Custom Highlight API(Chromium 105+,Electron 42 支持)在不改 DOM 的前提下给
// markdown 渲染后的正文打命中高亮;虚拟化列表只高亮已渲染部分,数据层计数不受影响。
// 环境不支持(如 happy-dom 测试)时全部静默降级为 no-op。

export const FIND_HIGHLIGHT = "deskfox-find"
export const FIND_HIGHLIGHT_ACTIVE = "deskfox-find-active"

type HighlightRegistry = {
  set: (name: string, highlight: unknown) => void
  delete: (name: string) => void
}

const registry = (): HighlightRegistry | undefined => {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS
  return css?.highlights
}

const HighlightCtor = (): (new (...ranges: Range[]) => unknown) | undefined =>
  (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight

export function highlightSupported(): boolean {
  return !!registry() && !!HighlightCtor()
}

/** 在 root 的文本节点里收集 query 的所有出现(大小写不敏感),按文档序返回 Range */
export function collectRanges(root: Node, query: string): Range[] {
  if (!query) return []
  const doc = root.ownerDocument ?? (root as Document)
  if (!doc?.createTreeWalker) return []
  const needle = query.toLowerCase()
  const ranges: Range[] = []
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? ""
    const haystack = text.toLowerCase()
    let index = 0
    while (true) {
      index = haystack.indexOf(needle, index)
      if (index === -1) break
      const range = doc.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + needle.length)
      ranges.push(range)
      index += needle.length
    }
  }
  return ranges
}

/** 应用普通命中层 + 活跃命中层;返回活跃 Range(供 scrollIntoView) */
export function applyHighlights(ranges: Range[], activeRange: Range | undefined): void {
  const highlights = registry()
  const Ctor = HighlightCtor()
  if (!highlights || !Ctor) return
  highlights.set(FIND_HIGHLIGHT, new Ctor(...ranges))
  if (activeRange) highlights.set(FIND_HIGHLIGHT_ACTIVE, new Ctor(activeRange))
  else highlights.delete(FIND_HIGHLIGHT_ACTIVE)
}

export function clearHighlights(): void {
  const highlights = registry()
  if (!highlights) return
  highlights.delete(FIND_HIGHLIGHT)
  highlights.delete(FIND_HIGHLIGHT_ACTIVE)
}

/** 在 scroller 已渲染内容中定位「anchor 轮次的第 localIndex 个出现」:
 *  取锚点元素(#message-<anchorID> 或 [data-message-id]),从其文档位置起筛出其后的 Range,
 *  下一个锚点行之前的第 localIndex 个即目标。找不到(未渲染/虚拟化)返回 undefined。 */
export function locateActiveRange(
  scroller: HTMLElement,
  ranges: Range[],
  anchorID: string,
  localIndex: number,
): Range | undefined {
  const anchorEl =
    scroller.querySelector(`[data-message-id="${CSS.escape(anchorID)}"]`) ??
    scroller.ownerDocument.getElementById(`message-${anchorID}`)
  if (!anchorEl) return undefined
  const anchors = Array.from(scroller.querySelectorAll("[data-message-id]"))
  const anchorIdx = anchors.indexOf(anchorEl as Element)
  const nextAnchor = anchorIdx >= 0 ? anchors[anchorIdx + 1] : undefined
  // node 属于本轮 = 在锚点行内或其后,且不落入下一锚点行内或其后
  const inOrAfter = (node: Node, ref: Element) =>
    ref.contains(node) || !!(ref.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
  const inTurn = ranges.filter((range) => {
    const node = range.startContainer
    if (!inOrAfter(node, anchorEl as Element)) return false
    if (nextAnchor && inOrAfter(node, nextAnchor)) return false
    return true
  })
  return inTurn[localIndex]
}
