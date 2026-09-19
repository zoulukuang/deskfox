import type { FileContextItem, Prompt } from "@/context/prompt"
import { selectionFromLines, type SelectedLineRange } from "@/context/file"

const DEFAULT_PROMPT: Prompt = [{ type: "text", content: "", start: 0, end: 0 }]

export const MAX_HISTORY = 100

export type PromptHistoryComment = {
  // FORK 2026-09-19 第四轮 code-review:`id` 放开成可选 —— 它是**真批注 ID**,不是"某个标识符"。
  //   上一版为了填满这个必填字段写了 `item.commentID ?? item.key`,于是本来没有批注的卡
  //   (无注释的选区卡 / 无选区的附件卡)在快照里被塞进一个伪 ID,回填时又当成真 ID 写回
  //   `commentID` —— 往返不是恒等,而**三处下游都以"有无 commentID"分流**(见下面 bug-repro)。
  //   没有批注就让它缺席:回填后 `contextItemKey` 会按原样重算出同一个 key,它不需要被持久化。
  id?: string
  path: string
  // FORK 2026-09-18:selection / comment 放开成可选 —— 见下面 contextItemsToHistoryComments 的说明。
  //   无选区的附件卡、无注释的引用卡都必须能被历史快照**原样带回来**,否则上下键翻一次历史就丢。
  selection?: SelectedLineRange
  comment?: string
  time: number
  origin?: "review" | "file" | "quote"
  preview?: string
  // FORK: REQ-123 — 缺了它,从 ↑ 历史找回的聊天引用会退化成文件卡片
  // (UI 显伪路径文件名、LLM 模板走 file 分支)2026-08-19
  kind?: "chat" | "file"
}

// FORK: REQ-123 — ↑ 历史条目回填成引用卡片的映射。原先 legacy composer 与 v2 composer
// 各写了一份等价的内联映射,`kind` 就是两边一起漏掉的(→ 找回的聊天引用退化成文件卡片)。
// 收口成一处纯函数,顺带可单测。2026-08-19
export function historyCommentToContextItem(item: PromptHistoryComment): FileContextItem {
  return {
    type: "file",
    path: item.path,
    selection: item.selection ? selectionFromLines(item.selection) : undefined,
    comment: item.comment,
    commentID: item.id,
    commentOrigin: item.origin,
    preview: item.preview,
    kind: item.kind,
  }
}

/**
 * 输入框里的引用/附件卡 → 历史快照条目。
 *
 * FORK 2026-09-18 第三轮 code-review:
 * [bug-repro: `isCommentItem` 这批放宽成"只看 type === file",于是 `replaceComments` 的**移除侧**
 *  会清掉全部 file 卡;而快照的**产出侧**仍要求 `comment?.trim()` 且必须有 selection,
 *  于是无注释的选区卡、无选区的附件卡进不了快照 —— 上下键翻一次历史就被 replaceComments
 *  清掉且再也回不来,全程无任何提示。]
 *
 * 不变量一:**移除的集合 ⊆ 快照能表达的集合**。两侧判据必须同源,否则差集就是静默丢数据。
 *
 * 不变量二(2026-09-19 补):**往返恒等** —— 进快照再回来的卡,必须与进去前是同一张卡。
 * 判据同源只保证"不丢",恒等才保证"不变形"。
 *
 * FORK 2026-09-19 第四轮 code-review:
 * [bug-repro: 上一版写 `id: item.commentID ?? item.key` —— 无批注的卡被塞进伪 ID(= 前端 dedup key),
 *  `historyCommentToContextItem` 再把它写回 `commentID`,于是历史往返**不恒等**,三处以
 *  「有无 commentID」分流的下游全被击穿:① `contextItemKey` 从 `file:/a.ts:3:5` 变成
 *  `file:/a.ts:3:5:c=file:/a.ts:3:5`,与重新添加同一选区算出的 key 不等 → `context.add()` 去重失效,
 *  输入框出现两张同源卡并一起发给模型 ② `build-request-parts.ts` 有 commentID 的分支不写 url 集,
 *  「prompt 已 @mention 同路径则丢重复卡」对历史找回的卡失效 ③ `openComment` 的
 *  `if (!item.commentID) return` 守卫被绕过 → 点这张卡会去 focus 一条不存在的批注,
 *  还顺手撑开评审面板 / 切走 tab(改动前点它是 no-op)。]
 *
 * 另:此函数原先在 legacy composer 与 v2 composer 里**各抄了一份**逐行等价的实现 ——
 * 正是 REQ-123 当年 `kind` 在两边一起漏掉的同款结构。这次一并收口成一处纯函数(可单测)。
 */
export function contextItemsToHistoryComments(input: {
  // `key` 是 store 内的 dedup key,快照**不持久化它**(回填后由 contextItemKey 重算);
  // 这里留成可选只为兼容调用方直接传 store items。
  items: readonly (FileContextItem & { key?: string })[]
  comments: readonly { file: string; id: string; selection: SelectedLineRange; time: number }[]
  now?: () => number
}): PromptHistoryComment[] {
  const now = input.now ?? Date.now
  const byID = new Map(input.comments.map((item) => [`${item.file}\n${item.id}`, item] as const))
  return input.items.flatMap((item) => {
    if (item.type !== "file") return []
    const stored = item.commentID ? byID.get(`${item.path}\n${item.commentID}`) : undefined
    const selection =
      stored?.selection ??
      (item.selection ? ({ start: item.selection.startLine, end: item.selection.endLine } as SelectedLineRange) : undefined)
    const comment = item.comment?.trim()
    return [
      {
        // 没有真批注就缺席 —— 绝不用 key 顶位(见上 bug-repro)
        id: item.commentID,
        path: item.path,
        selection: selection ? { ...selection } : undefined,
        comment: comment || undefined,
        time: stored?.time ?? now(),
        origin: item.commentOrigin,
        preview: item.preview,
        // FORK: REQ-123 — 缺了它,历史找回的聊天引用会退化成文件卡片 2026-08-19
        kind: item.kind,
      } satisfies PromptHistoryComment,
    ]
  })
}

export type PromptHistoryEntry = {
  prompt: Prompt
  comments: PromptHistoryComment[]
}

export type PromptHistoryStoredEntry = Prompt | PromptHistoryEntry

export function canNavigateHistoryAtCursor(direction: "up" | "down", text: string, cursor: number, inHistory = false) {
  const position = Math.max(0, Math.min(cursor, text.length))
  const atStart = position === 0
  const atEnd = position === text.length
  if (inHistory) return atStart || atEnd
  if (direction === "up") return position === 0 && text.length === 0
  return position === text.length
}

export function clonePromptParts(prompt: Prompt): Prompt {
  return prompt.map((part) => {
    if (part.type === "text") return { ...part }
    if (part.type === "image") return { ...part }
    if (part.type === "agent") return { ...part }
    return {
      ...part,
      selection: part.selection ? { ...part.selection } : undefined,
    }
  })
}

function cloneSelection(selection: SelectedLineRange): SelectedLineRange {
  return {
    start: selection.start,
    end: selection.end,
    ...(selection.side ? { side: selection.side } : {}),
    ...(selection.endSide ? { endSide: selection.endSide } : {}),
  }
}

export function clonePromptHistoryComments(comments: PromptHistoryComment[]) {
  return comments.map((comment) => ({
    ...comment,
    selection: comment.selection ? cloneSelection(comment.selection) : undefined,
  }))
}

// FORK-BEGIN: REQ-087 历史不存图片 part [feat: renderer-snapshot-oom] 2026-08-02
// ImageAttachmentPart.dataUrl 是完整 base64,100 条历史 × 截图级图片 = GB 级快照,
// 是 renderer OOM + global.dat 膨胀的头号来源。历史仅回填文本/文件引用/comment;
// normalize 侧同样过滤,兜住 migrate 前的存量脏数据。
function withoutImageParts(prompt: Prompt): Prompt {
  return prompt.filter((part) => part.type !== "image")
}

/** persisted migrate 钩子:清洗存量历史里的图片 part,变空壳的 entry 一并丢弃。 */
export function migrateStoredHistory(value: unknown): unknown {
  if (!value || typeof value !== "object" || !Array.isArray((value as { entries?: unknown }).entries)) return value
  const entries = (value as { entries: unknown[] }).entries
    .map((entry) => {
      if (Array.isArray(entry)) return withoutImageParts(entry as Prompt)
      if (!entry || typeof entry !== "object") return entry
      const stored = entry as PromptHistoryEntry
      if (!Array.isArray(stored.prompt)) return entry
      return { ...stored, prompt: withoutImageParts(stored.prompt) }
    })
    .filter((entry) => {
      const normalized = Array.isArray(entry) ? { prompt: entry as Prompt, comments: [] } : (entry as PromptHistoryEntry)
      if (!Array.isArray(normalized.prompt)) return true
      const text = promptLength(normalized.prompt) > 0
      const comments = Array.isArray(normalized.comments) && normalized.comments.some((c) => !!c?.comment?.trim())
      return text || comments
    })
  return { ...(value as object), entries }
}
// FORK-END

export function normalizePromptHistoryEntry(entry: PromptHistoryStoredEntry): PromptHistoryEntry {
  if (Array.isArray(entry)) {
    return {
      // FORK: REQ-087 历史不含图片 part(存量兜底过滤)[feat: renderer-snapshot-oom] 2026-08-02
      prompt: clonePromptParts(withoutImageParts(entry)),
      comments: [],
    }
  }
  return {
    // FORK: REQ-087 同上 [feat: renderer-snapshot-oom] 2026-08-02
    prompt: clonePromptParts(withoutImageParts(entry.prompt)),
    comments: clonePromptHistoryComments(entry.comments),
  }
}

export function promptLength(prompt: Prompt) {
  return prompt.reduce((len, part) => len + ("content" in part ? part.content.length : 0), 0)
}

export function prependHistoryEntry(
  entries: PromptHistoryStoredEntry[],
  prompt: Prompt,
  comments: PromptHistoryComment[] = [],
  max = MAX_HISTORY,
) {
  const text = prompt
    .map((part) => ("content" in part ? part.content : ""))
    .join("")
    .trim()
  // FORK 2026-09-18:comment 现在可选(快照要能带回无注释的卡)。这里的语义**保持不变** ——
  //   「有没有值得入历史的内容」仍按"有注释"算,不因为快照变宽而改变入历史的门槛。
  const hasComments = comments.some((comment) => !!comment.comment?.trim())
  // FORK: REQ-087 历史不存图片 part → 纯图片 prompt 无可回填内容,不入历史
  //   [feat: renderer-snapshot-oom] 2026-08-02
  if (!text && !hasComments) return entries

  const entry = {
    // FORK: REQ-087 剥离图片 part(dataUrl 不落盘)[feat: renderer-snapshot-oom] 2026-08-02
    prompt: clonePromptParts(prompt.filter((part) => part.type !== "image")),
    comments: clonePromptHistoryComments(comments),
  } satisfies PromptHistoryEntry
  const last = entries[0]
  if (last && isPromptEqual(last, entry)) return entries
  return [entry, ...entries].slice(0, max)
}

function isCommentEqual(commentA: PromptHistoryComment, commentB: PromptHistoryComment) {
  return (
    commentA.path === commentB.path &&
    commentA.comment === commentB.comment &&
    commentA.origin === commentB.origin &&
    commentA.preview === commentB.preview &&
    commentA.selection?.start === commentB.selection?.start &&
    commentA.selection?.end === commentB.selection?.end &&
    commentA.selection?.side === commentB.selection?.side &&
    commentA.selection?.endSide === commentB.selection?.endSide
  )
}

function isPromptEqual(promptA: PromptHistoryStoredEntry, promptB: PromptHistoryStoredEntry) {
  const entryA = normalizePromptHistoryEntry(promptA)
  const entryB = normalizePromptHistoryEntry(promptB)
  if (entryA.prompt.length !== entryB.prompt.length) return false
  for (let i = 0; i < entryA.prompt.length; i++) {
    const partA = entryA.prompt[i]
    const partB = entryB.prompt[i]
    if (partA.type !== partB.type) return false
    if (partA.type === "text" && partA.content !== (partB.type === "text" ? partB.content : "")) return false
    if (partA.type === "file") {
      if (partA.path !== (partB.type === "file" ? partB.path : "")) return false
      const a = partA.selection
      const b = partB.type === "file" ? partB.selection : undefined
      const sameSelection =
        (!a && !b) ||
        (!!a &&
          !!b &&
          a.startLine === b.startLine &&
          a.startChar === b.startChar &&
          a.endLine === b.endLine &&
          a.endChar === b.endChar)
      if (!sameSelection) return false
    }
    if (partA.type === "agent" && partA.name !== (partB.type === "agent" ? partB.name : "")) return false
    if (partA.type === "image" && partA.id !== (partB.type === "image" ? partB.id : "")) return false
  }
  if (entryA.comments.length !== entryB.comments.length) return false
  for (let i = 0; i < entryA.comments.length; i++) {
    const commentA = entryA.comments[i]
    const commentB = entryB.comments[i]
    if (!commentA || !commentB || !isCommentEqual(commentA, commentB)) return false
  }
  return true
}

type HistoryNavInput = {
  direction: "up" | "down"
  entries: PromptHistoryStoredEntry[]
  historyIndex: number
  currentPrompt: Prompt
  currentComments: PromptHistoryComment[]
  savedPrompt: PromptHistoryEntry | null
}

type HistoryNavResult =
  | {
      handled: false
      historyIndex: number
      savedPrompt: PromptHistoryEntry | null
    }
  | {
      handled: true
      historyIndex: number
      savedPrompt: PromptHistoryEntry | null
      entry: PromptHistoryEntry
      cursor: "start" | "end"
    }

export function navigatePromptHistory(input: HistoryNavInput): HistoryNavResult {
  if (input.direction === "up") {
    if (input.entries.length === 0) {
      return {
        handled: false,
        historyIndex: input.historyIndex,
        savedPrompt: input.savedPrompt,
      }
    }

    if (input.historyIndex === -1) {
      const entry = normalizePromptHistoryEntry(input.entries[0])
      return {
        handled: true,
        historyIndex: 0,
        savedPrompt: {
          prompt: clonePromptParts(input.currentPrompt),
          comments: clonePromptHistoryComments(input.currentComments),
        },
        entry,
        cursor: "start",
      }
    }

    if (input.historyIndex < input.entries.length - 1) {
      const next = input.historyIndex + 1
      const entry = normalizePromptHistoryEntry(input.entries[next])
      return {
        handled: true,
        historyIndex: next,
        savedPrompt: input.savedPrompt,
        entry,
        cursor: "start",
      }
    }

    return {
      handled: false,
      historyIndex: input.historyIndex,
      savedPrompt: input.savedPrompt,
    }
  }

  if (input.historyIndex > 0) {
    const next = input.historyIndex - 1
    const entry = normalizePromptHistoryEntry(input.entries[next])
    return {
      handled: true,
      historyIndex: next,
      savedPrompt: input.savedPrompt,
      entry,
      cursor: "end",
    }
  }

  if (input.historyIndex === 0) {
    if (input.savedPrompt) {
      return {
        handled: true,
        historyIndex: -1,
        savedPrompt: null,
        entry: input.savedPrompt,
        cursor: "end",
      }
    }

    return {
      handled: true,
      historyIndex: -1,
      savedPrompt: null,
      entry: {
        prompt: DEFAULT_PROMPT,
        comments: [],
      },
      cursor: "end",
    }
  }

  return {
    handled: false,
    historyIndex: input.historyIndex,
    savedPrompt: input.savedPrompt,
  }
}
