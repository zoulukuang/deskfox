// FORK-ONLY file: REQ-097 会话内查找 — 纯逻辑(Logic 清单)[feat: in-session-find]
//
// 匹配单位 = 出现次(occurrence),按「可定位单元」组织:
// - user 单元:一条 user 消息的全部 text part 拼接(渲染在同一行,行锚 data-message-id)
// - assistant 单元:单个 text part(各自成行,行标 data-find-part-ids)
// 跳转 = 虚拟列表 scrollToIndex 直达该单元所在行 → 行内取第 indexInUnit 个 Range(数据直达,
// 不依赖 DOM 顺序/几何——virtua 行复用使文档序与视觉序解耦,几何/文档序方案在真机均失效)。

export type TurnUnit = {
  anchorID: string
  /** user 单元 = anchorID 本身;assistant 单元 = part id */
  unitID: string
  isUser: boolean
  text: string
}

export type Occurrence = {
  anchorID: string
  unitID: string
  isUser: boolean
  indexInUnit: number
}

/** 大小写不敏感的子串出现次数(CJK 安全;重叠不计,如 "aa" in "aaa" = 1) */
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

/** 展开为扁平出现列表(单元序 × 单元内序 = 会话内容序) */
export function buildOccurrences(units: TurnUnit[], query: string): Occurrence[] {
  if (!query.trim()) return []
  const out: Occurrence[] = []
  for (const unit of units) {
    const count = countOccurrences(unit.text, query)
    for (let i = 0; i < count; i++) {
      out.push({ anchorID: unit.anchorID, unitID: unit.unitID, isUser: unit.isUser, indexInUnit: i })
    }
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
