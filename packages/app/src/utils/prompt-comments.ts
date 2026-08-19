// FORK: REQ-123 — 从消息 parts 还原引用卡片(撤回保真回填)。fork-only 新文件。
//
// 背景:撤回一条消息时,`session.tsx` 只把文本流(`Prompt` = ContentPart[])放回输入框,
// 而引用卡片是**另一块状态**(`prompt.context.items` 里的 FileContextItem),没人还原 ——
// 于是撤回一条带引用的消息,卡片就丢了,用户得回去重新选一次文字。纯引用消息更明显:
// 撤回后输入框空空如也,内容看似人间蒸发(实际还在消息的 synthetic part metadata 里)。
//
// 数据来源:发送时 `build-request-parts.ts` 通过 `createCommentMetadata` 把
// path / selection / comment / preview / origin / kind 原样写进 synthetic text part 的 metadata,
// 这里 `readCommentMetadata` 读回来就是现成的 PromptComment —— 本文件是它的逆函数。
// 2026-08-19
import type { Part, TextPart } from "@opencode-ai/sdk/v2"
import type { FileContextItem } from "@/context/prompt"
import { parseCommentNote, readCommentMetadata, type PromptComment } from "@/utils/comment-note"
import { isChatSelectionPath } from "@opencode-ai/core/util/chat-selection"

/**
 * 引用卡片的 commentID —— 前端 dedup key(`contextItemKey`),不是持久标识。
 *
 * hash 部分保持与 `context-menu-host/host.tsx` 同一算法:聊天引用没有行号,
 * 光靠 `path:start:end` 会把同源的多次选区 dedup 成一条,必须靠 preview 的 hash 拉开。
 * suffix 由调用方给:新建卡片用时间戳(每次都是新卡片),还原用 part.id
 * (同一条消息反复撤回得到同一个 ID = 幂等,且同消息内两条引用互不相同)。
 */
export function quoteCommentID(preview: string, suffix: string) {
  let hash = 0
  for (let i = 0; i < preview.length; i++) {
    hash = ((hash << 5) - hash + preview.charCodeAt(i)) | 0
  }
  return `quote-${Math.abs(hash).toString(36)}-${suffix}`
}

/**
 * 把消息 parts 里的引用卡片还原成 prompt context items。
 *
 * 只认 synthetic text part(引用卡片发出去后的形态,与 `MessageComment.fromPart` 同一判据);
 * `origin: "review"` 的行评论**不还原** —— 它归 review 面板管,回填会与面板状态打架。
 */
export function extractCommentsFromParts(parts: Part[] | undefined): FileContextItem[] {
  const items: FileContextItem[] = []
  for (const part of parts ?? []) {
    if (part.type !== "text") continue
    const textPart = part as TextPart
    if (!textPart.synthetic) continue

    // metadata 是 REQ-065 之后的形态;老消息只有正文,退回文本模板解析(与 rows.ts 同一兜底)
    const meta: PromptComment | undefined = readCommentMetadata(textPart.metadata) ?? parseCommentNote(textPart.text)
    if (!meta) continue
    if (meta.origin === "review") continue

    const preview = meta.preview
    // kind 缺失的老消息:伪路径 = 聊天引用(否则卡片会退化成显示 `<chat selection>` 的文件卡)
    const kind = meta.kind ?? (isChatSelectionPath(meta.path) ? "chat" : undefined)
    items.push({
      type: "file",
      path: meta.path,
      selection: meta.selection,
      comment: meta.comment,
      // 缺省按 "quote" 还原而不是留 undefined:undefined 会让点开卡片的逻辑
      // (prompt-input.tsx `openComment`)去猜 review 面板,而这里还原的确定是 prompt 卡片
      commentOrigin: meta.origin ?? "quote",
      preview,
      kind,
      commentID: quoteCommentID(preview || meta.comment, textPart.id),
    })
  }
  return items
}
