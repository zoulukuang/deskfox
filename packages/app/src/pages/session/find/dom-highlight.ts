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

/** 数据直达定位:在「出现所属的可定位单元」的行元素内取第 indexInUnit 个 Range。
 *  - user 单元:行锚 [data-message-id=anchorID](一条 user 消息的全部 text part 同行渲染)
 *  - assistant 单元:行标 [data-find-part-ids~=unitID](timeline 行帧铺设,fork 属性)
 *  行未渲染(虚拟化卸载/深位未加载)返回 undefined,由调用方先 scrollToIndex 该行再重试。
 *  不依赖跨行 DOM 顺序与几何 —— virtua 行复用使两者都不可信(真机实证)。 */
export function locateRangeInUnit(
  scroller: HTMLElement,
  query: string,
  unit: { anchorID: string; unitID: string; isUser: boolean; indexInUnit: number },
): Range | undefined {
  const el = unit.isUser
    ? scroller.querySelector(`[data-message-id="${CSS.escape(unit.anchorID)}"]`)
    : scroller.querySelector(`[data-find-part-ids~="${CSS.escape(unit.unitID)}"]`)
  if (!el) return undefined
  return collectRanges(el, query)[unit.indexInUnit]
}
