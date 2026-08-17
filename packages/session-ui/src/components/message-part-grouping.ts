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

// FORK: REQ-113 时间线噪声治理 —— 两类各按自己的分寸处理,不一刀切:
//   A. `invalid`(模型调了不存在的工具)= 纯噪声,连内容都逐字相同 → 合并成一行计数、可展开。
//      合并**不隐藏信号**:连续 N 次调不到工具说明 agent 在空转,合成一行反而比刷屏 N 行更醒目。
//   B. `edit`/`write` = 有副作用、用户最需要看见的操作 → **绝不收进折叠组**,
//      只把「同一个文件的连续多次编辑」合成一行 + ×N 计数,文件名原样留在标题上。
//      合并键 = input.filePath;`patch` 用的是 input.files,首版不做(留后)。
//   [feat: session-presentation-input-batch] 2026-08-17
export const EDIT_MERGE_TOOLS = new Set(["edit", "write"])

export function isInvalidTool(part: PartType): part is ToolPart {
  return part.type === "tool" && part.tool === "invalid"
}

export function isEditMergeTool(part: PartType): part is ToolPart {
  return part.type === "tool" && EDIT_MERGE_TOOLS.has(part.tool)
}

// FORK: 同文件判定 —— 取不到 filePath 就不参与合并(宁可多一行,不要错并两个文件)。
//   ⚠️ **只合并 completed**:失败/进行中的编辑是信号不是重复,合并会把其中一次失败整个藏掉
//   (2026-08-17 被上游 tool-projection e2e 抓到 —— 连续失败的 edit+write 同文件被错并成一行,
//    错误卡从 10 张掉到 9 张)。同理 pending/running 也不并,免得把在跑的那次吞进历史行。
function editMergeKey(part: PartType): string | undefined {
  if (!isEditMergeTool(part)) return undefined
  if (part.state?.status !== "completed") return undefined
  const input = part.state?.input as Record<string, unknown> | undefined
  const filePath = input?.filePath
  return typeof filePath === "string" && filePath ? filePath : undefined
}

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
//       "invalid" = REQ-113A 无效调用合并组(同为可折叠组)
//       "repeat"  = REQ-113B 同文件连续编辑合并行 —— **不是折叠组**,
//                   渲染成单张编辑卡 + ×N 计数,可见性不降级(见文件头 B 段)
export type PartGroupRunType = "context" | "command" | "invalid"
export type PartGroupMergeType = PartGroupRunType | "repeat"

export type PartGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
    }
  | {
      key: string
      type: PartGroupMergeType
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
//   REQ-113 的 invalid 合并与同文件 edit 合并**无开关、始终生效**:两者都只去重复不降可见性,
//   没有"想看逐条刷屏"的合理诉求;上游 e2e 断言不涉及连续同类 invalid/edit,不需要种默认。
export function groupParts(parts: { messageID: string; part: PartType }[], options?: { shellGrouped?: boolean }) {
  const result: PartGroup[] = []
  let start = -1
  let runType: PartGroupMergeType | undefined
  // FORK: REQ-113B —— 当前 edit 合并串锁定的文件;换文件即断开重新计数
  let runMergeKey: string | undefined

  const flush = (end: number) => {
    if (start < 0 || !runType) return
    const first = parts[start]
    const last = parts[end]
    if (!first || !last) {
      start = -1
      runType = undefined
      runMergeKey = undefined
      return
    }
    const refs = parts.slice(start, end + 1).map((item) => ({
      messageID: item.messageID,
      partID: item.part.id,
    }))
    // FORK: REQ-113B —— 单次编辑没什么可合并的,原样退回独立 part 行(可见性零降级)
    if (runType === "repeat" && refs.length === 1) {
      result.push({
        key: `part:${first.messageID}:${first.part.id}`,
        type: "part",
        ref: refs[0]!,
      })
    } else {
      result.push({ key: `${runType}:${first.part.id}`, type: runType, refs })
    }
    start = -1
    runType = undefined
    runMergeKey = undefined
  }

  const runTypeOf = (part: PartType): PartGroupMergeType | undefined => {
    if (isContextGroupTool(part)) return "context"
    if (options?.shellGrouped && isShellGroupTool(part)) return "command"
    if (isInvalidTool(part)) return "invalid"
    if (editMergeKey(part)) return "repeat"
    return undefined
  }

  parts.forEach((item, index) => {
    const type = runTypeOf(item.part)
    if (type) {
      const mergeKey = type === "repeat" ? editMergeKey(item.part) : undefined
      // FORK: 各类组不互相吞并;edit 合并串还要求**同一个文件**,换文件同样先收尾
      if (runType && (runType !== type || runMergeKey !== mergeKey)) flush(index - 1)
      if (start < 0) {
        start = index
        runType = type
        runMergeKey = mergeKey
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
