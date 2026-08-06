// FORK-ONLY file: REQ-095 会话内容搜索 — snippet 高亮定界符解析(Logic 清单)[feat: session-content-search]
//
// 服务端 snippet 用私用区字符 U+E000/U+E001 标注命中词(与 sidecar
// packages/opencode/src/session/search/fts-sql.ts 的 HL_START/HL_END 对应)。
// LIKE 路径的 TS 侧打标可能产生嵌套标记(短词命中在长词标记内),解析用深度计数容错。

export const SNIPPET_HL_START = "\uE000"
export const SNIPPET_HL_END = "\uE001"

export type SnippetSegment = { text: string; highlight: boolean }

/** 把带定界符的 snippet 拆成分段;嵌套/不配对的标记按深度容错,绝不抛错 */
export function parseSnippet(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = []
  let depth = 0
  let buffer = ""
  const flush = () => {
    if (!buffer) return
    segments.push({ text: buffer, highlight: depth > 0 })
    buffer = ""
  }
  for (const ch of snippet) {
    if (ch === SNIPPET_HL_START) {
      flush()
      depth += 1
      continue
    }
    if (ch === SNIPPET_HL_END) {
      flush()
      depth = Math.max(0, depth - 1)
      continue
    }
    buffer += ch
  }
  flush()
  // 相邻同态分段合并(嵌套标记会切出碎片)
  const merged: SnippetSegment[] = []
  for (const segment of segments) {
    const last = merged[merged.length - 1]
    if (last && last.highlight === segment.highlight) {
      last.text += segment.text
      continue
    }
    merged.push({ ...segment })
  }
  return merged
}
