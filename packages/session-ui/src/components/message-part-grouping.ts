// FORK: 从 message-part.tsx 抽出的纯分组逻辑(无 SolidJS/Kobalte 依赖,可单测)。
// 抽出动机:groupParts 等是纯函数,但原文件 import 了 client-only 组件,bun 单测加载即抛
// "Client-only API called on the server side"。helper extract → Logic 清单。2026-06-19
import type { Part as PartType, ToolPart } from "@opencode-ai/sdk/v2"

// FORK 撤销记录:2026-06-19 曾把 bash 纳入折叠组消除竖向铺开;2026-08-11 sync v1.18.4 撤销、
// 对齐上游 —— 上游 v2 时间线已用 shellToolPartsExpanded 默认收起解决同一问题,且新增 10+ 条
// shell 族 e2e 断言 bash 独立成行,保留定制=长期改写上游 spec。决策见 upstream-sync-2026-08/2-plan.md
export const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])

export function isContextGroupTool(part: PartType): part is ToolPart {
  return part.type === "tool" && CONTEXT_GROUP_TOOLS.has(part.tool)
}

export type PartRef = {
  messageID: string
  partID: string
}

export type PartGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
    }
  | {
      key: string
      type: "context"
      refs: PartRef[]
    }

function sameRef(a: PartRef, b: PartRef) {
  return a.messageID === b.messageID && a.partID === b.partID
}

function sameGroup(a: PartGroup, b: PartGroup) {
  if (a === b) return true
  if (a.key !== b.key) return false
  if (a.type !== b.type) return false
  if (a.type === "part") {
    if (b.type !== "part") return false
    return sameRef(a.ref, b.ref)
  }
  if (b.type !== "context") return false
  if (a.refs.length !== b.refs.length) return false
  return a.refs.every((ref, i) => sameRef(ref, b.refs[i]!))
}

export function sameGroups(a: readonly PartGroup[] | undefined, b: readonly PartGroup[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((item, i) => sameGroup(item, b[i]!))
}

export function groupParts(parts: { messageID: string; part: PartType }[]) {
  const result: PartGroup[] = []
  let start = -1

  const flush = (end: number) => {
    if (start < 0) return
    const first = parts[start]
    const last = parts[end]
    if (!first || !last) {
      start = -1
      return
    }
    result.push({
      key: `context:${first.part.id}`,
      type: "context",
      refs: parts.slice(start, end + 1).map((item) => ({
        messageID: item.messageID,
        partID: item.part.id,
      })),
    })
    start = -1
  }

  parts.forEach((item, index) => {
    if (isContextGroupTool(item.part)) {
      if (start < 0) start = index
      return
    }

    flush(index - 1)
    result.push({
      key: `part:${item.messageID}:${item.part.id}`,
      type: "part",
      ref: {
        messageID: item.messageID,
        partID: item.part.id,
      },
    })
  })

  flush(parts.length - 1)
  return result
}
