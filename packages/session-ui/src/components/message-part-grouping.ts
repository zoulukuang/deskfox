// FORK: 从 message-part.tsx 抽出的纯分组逻辑(无 SolidJS/Kobalte 依赖,可单测)。
// 抽出动机:groupParts 等是纯函数,但原文件 import 了 client-only 组件,bun 单测加载即抛
// "Client-only API called on the server side"。helper extract → Logic 清单。2026-06-19
import type { Part as PartType, ToolPart } from "@opencode-ai/sdk/v2"

// FORK 决策记录(按时间):
//   2026-06-19 把 bash 并进「已探索」折叠组消除竖向铺开(commit 2a60c849b8);
//   2026-08-11 sync v1.18.4 撤销、对齐上游 —— 理由是上游 v2 已用 shellToolPartsExpanded 默认收起,
//     且新增 10+ 条 shell 族 e2e 断言 bash 独立成行,保留定制=长期改写上游 spec;
//   2026-08-17 REQ-109 以**可配置**形式回归(user 报「新版把大量 shell 命令都平铺暴露出来了」):
//     - 折叠开关 `shellGrouped` 走设置项 shellToolPartsGrouped(产品默认 true),
//       e2e fixture 种 false → 上游那 10+ 条断言零改动全绿,两套口径都是合法配置,不再改上游 spec;
//     - **命令自成一组,不再并进「已探索」**(2026-08-15 user 看过对比例子后拍板:7 个调用里混着
//       `git checkout --` / `rm -rf` / `git reset --hard`,和 read/grep 同组会把破坏性操作藏进
//       「探索」语义里)。这一条是定案内容,别当"多余的一行"顺手合并回同组。
//   [feat: session-presentation-input-batch]
export const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list"])

// FORK: 与 part-default-open.ts 的 shell 判定保持同一口径(bash / shell)
export const SHELL_GROUP_TOOLS = new Set(["bash", "shell"])

export function isContextGroupTool(part: PartType): part is ToolPart {
  return part.type === "tool" && CONTEXT_GROUP_TOOLS.has(part.tool)
}

// FORK: REQ-109
export function isShellGroupTool(part: PartType): part is ToolPart {
  return part.type === "tool" && SHELL_GROUP_TOOLS.has(part.tool)
}

export type PartRef = {
  messageID: string
  partID: string
}

// FORK: "command" = REQ-109 独立命令组(与 "context" 平级,不是它的子集)
export type PartGroupRunType = "context" | "command"

export type PartGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
    }
  | {
      key: string
      type: PartGroupRunType
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
  if (b.type === "part") return false
  if (a.refs.length !== b.refs.length) return false
  return a.refs.every((ref, i) => sameRef(ref, b.refs[i]!))
}

export function sameGroups(a: readonly PartGroup[] | undefined, b: readonly PartGroup[] | undefined) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  return a.every((item, i) => sameGroup(item, b[i]!))
}

// FORK: options.shellGrouped —— REQ-109 连续 shell 收进独立命令组。
//   缺省(undefined/false)= 上游口径:shell 独立成行,分组行为与上游逐字一致。
export function groupParts(parts: { messageID: string; part: PartType }[], options?: { shellGrouped?: boolean }) {
  const result: PartGroup[] = []
  let start = -1
  let runType: PartGroupRunType | undefined

  const flush = (end: number) => {
    if (start < 0 || !runType) return
    const first = parts[start]
    const last = parts[end]
    if (!first || !last) {
      start = -1
      runType = undefined
      return
    }
    result.push({
      key: `${runType}:${first.part.id}`,
      type: runType,
      refs: parts.slice(start, end + 1).map((item) => ({
        messageID: item.messageID,
        partID: item.part.id,
      })),
    })
    start = -1
    runType = undefined
  }

  const runTypeOf = (part: PartType): PartGroupRunType | undefined => {
    if (isContextGroupTool(part)) return "context"
    if (options?.shellGrouped && isShellGroupTool(part)) return "command"
    return undefined
  }

  parts.forEach((item, index) => {
    const type = runTypeOf(item.part)
    if (type) {
      // FORK: 两种组不互相吞并 —— 探索转命令(或反之)时先收尾上一组
      if (runType && runType !== type) flush(index - 1)
      if (start < 0) {
        start = index
        runType = type
      }
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
