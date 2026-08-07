// FORK-ONLY file: REQ-097 会话内查找 — 纯逻辑(Logic 清单)[feat: in-session-find]
//
// 匹配单位 = 出现次(occurrence),按轮次(turn = user 消息 + 其 assistant 回复)组织:
// 导航滚动锚点用轮次的 user 消息 id(时间线行锚 data-message-id 只在 user 行,同 REQ-095 anchor 设计)。

export type TurnText = { anchorID: string; text: string }
export type Occurrence = { anchorID: string; localIndex: number }

/** 大小写不敏感的子串出现次数(CJK 安全,朴素 indexOf 扫描;重叠不计,如 "aa" in "aaa" = 1) */
export function countOccurrences(text: string, query: string): number {
  if (!query) return 0
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  let count = 0
  let index = 0
  while (true) {
    index = haystack.indexOf(needle, index)
    if (index === -1) break
    count += 1
    index += needle.length
  }
  return count
}

/** 展开为扁平出现列表(文档序:轮次序 × 轮内序) */
export function buildOccurrences(turns: TurnText[], query: string): Occurrence[] {
  if (!query.trim()) return []
  const out: Occurrence[] = []
  for (const turn of turns) {
    const count = countOccurrences(turn.text, query)
    for (let i = 0; i < count; i++) out.push({ anchorID: turn.anchorID, localIndex: i })
  }
  return out
}

/** 环形步进(total=0 时返回 -1) */
export function stepIndex(current: number, total: number, direction: 1 | -1): number {
  if (total <= 0) return -1
  if (current < 0) return direction === 1 ? 0 : total - 1
  return (current + direction + total) % total
}

/** ⌘K 联动:定位到指定锚点轮次的第一个出现;找不到回退 0(无出现回退 -1) */
export function indexForAnchor(occurrences: Occurrence[], anchorID: string | undefined): number {
  if (occurrences.length === 0) return -1
  if (!anchorID) return 0
  const index = occurrences.findIndex((occurrence) => occurrence.anchorID === anchorID)
  return index === -1 ? 0 : index
}
