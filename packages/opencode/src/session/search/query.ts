// FORK-ONLY file: REQ-095 会话记录内容搜索 — 查询规划(纯函数,Logic 清单)[feat: session-content-search]
//
// trigram tokenizer 的 MATCH 要求每个 token ≥3 字符;中文双字词(如"报错")高频,
// 所以任一 token <3 字符时整体降级为 LIKE 子串扫 content 表(有 LIMIT + 去抖,万级消息亚秒)。

import { HL_START, HL_END } from "./fts-sql"

export type SearchPlan =
  | { mode: "match"; match: string; tokens: string[] }
  | { mode: "like"; patterns: string[]; tokens: string[] }

const MAX_QUERY_LENGTH = 256
const MAX_TOKENS = 8

/** 提取查询词:连续的字母/数字/下划线段(\p{L} 含 CJK),丢标点;空结果 = 无法搜索 */
export function tokenize(raw: string): string[] {
  const trimmed = raw.slice(0, MAX_QUERY_LENGTH)
  const tokens = trimmed.match(/[\p{L}\p{N}_]+/gu) ?? []
  return tokens.filter(Boolean).slice(0, MAX_TOKENS)
}

/** LIKE 特殊字符转义(ESCAPE '\') */
export function escapeLike(token: string): string {
  return token.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")
}

/** 由原始输入产出查询计划;null = 无有效查询词(空串/纯标点) */
export function plan(raw: string): SearchPlan | null {
  const tokens = tokenize(raw)
  if (tokens.length === 0) return null
  // trigram MATCH 需要每个 token ≥3 字符;否则整体走 LIKE(AND 语义保持一致)
  if (tokens.every((t) => t.length >= 3)) {
    const match = tokens.map((t) => `"${t.replaceAll('"', "")}"`).join(" AND ")
    return { mode: "match", match, tokens }
  }
  return { mode: "like", patterns: tokens.map((t) => `%${escapeLike(t)}%`), tokens }
}

const SNIPPET_RADIUS = 36

/** LIKE 路径没有 snippet() 可用,在 TS 侧造片段:定位首个命中词,截 ±radius,标注所有窗口内命中 */
export function makeSnippet(body: string, tokens: string[], radius = SNIPPET_RADIUS): string {
  const lower = body.toLowerCase()
  let hitStart = -1
  let hitToken = ""
  for (const token of tokens) {
    const idx = lower.indexOf(token.toLowerCase())
    if (idx >= 0 && (hitStart === -1 || idx < hitStart)) {
      hitStart = idx
      hitToken = token
    }
  }
  if (hitStart === -1) {
    const head = body.slice(0, radius * 2)
    return head.length < body.length ? `${head}…` : head
  }
  const start = Math.max(0, hitStart - radius)
  const end = Math.min(body.length, hitStart + hitToken.length + radius)
  let window = body.slice(start, end)
  // 窗口内所有命中词都打标(大小写不敏感,逐词一遍)
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    if (!token) continue
    const pattern = new RegExp(escapeRegExp(token), "giu")
    window = window.replace(pattern, (m) => `${HL_START}${m}${HL_END}`)
  }
  const prefix = start > 0 ? "…" : ""
  const suffix = end < body.length ? "…" : ""
  return `${prefix}${window}${suffix}`
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
