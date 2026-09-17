// FORK-ONLY: REQ-131 引用卡片的数据提取(从 rows.ts 抽出)
// [feat: release-closeout-2026-09] 2026-09-17
//
// 抽出来的唯一理由是**可测**:rows.ts 经 @opencode-ai/session-ui/message-part 牵进
// markdown.worker(vite `?worker&url` 导入),bun test 直接 import 会报
// "Missing 'default' export"。这段逻辑本身是纯数据提取,不该被渲染层的构建期依赖绑架。
//
// REQ-131 的病灶就在 fromPart:它原先只挑 path/comment/selection 三项,把 preview(引文原文)
// 与 kind(chat/file)当场丢弃 —— 内容从来没丢,是这一层自己扔的,于是消息流里的引用卡片
// 只剩"<chat selection> + 我补的那句话",隔几轮回看根本不知道当初引的是哪段。

import { parseCommentNote, readCommentMetadata } from "@/utils/comment-note"
import { Part } from "@opencode-ai/sdk/v2"

export namespace MessageComment {
  export type MessageComment = {
    path: string
    comment: string
    selection?: {
      startLine: number
      endLine: number
    }
    // FORK-BEGIN: REQ-131 引用提交后看不到原文 [feat: release-closeout-2026-09] 2026-09-17
    // 内容从来没丢 —— createCommentMetadata 早就把引文原文写进了 synthetic part 的
    // metadata.opencodeComment(REQ-123 的撤回回填就靠它),readCommentMetadata 也读得回来。
    // 是这一层自己扔的:fromPart 原先只挑 path/comment/selection 三项,preview 当场丢弃,
    // 于是消息流里的引用卡片只剩"<chat selection> + 我补的那句话",引文一个字看不到。
    /** 引文原文。老消息(无 metadata)缺失,此时全链路退回现状,不为它新开机制 */
    preview?: string
    /** chat = 引用本次对话的一段话;file = 引用文件选区。决定卡片副标题怎么渲染 */
    kind?: "chat" | "file"
    // FORK-END
  }

  export const fromPart = (part: Part): MessageComment | undefined => {
    if (part.type !== "text" || !part.synthetic) return
    // FORK: REQ-131 —— preview/kind 只有 metadata 这一个来源。
    //   parseCommentNote 是老消息的文本回退解析,模板里根本没这两项;拆开取值,
    //   老消息缺失即 undefined,全链路退回现状,不为它新开机制。
    //   [feat: release-closeout-2026-09] 2026-09-17
    const meta = readCommentMetadata(part.metadata)
    const next = meta ?? parseCommentNote(part.text)
    if (!next) return
    return {
      path: next.path,
      comment: next.comment,
      selection: next.selection
        ? {
            startLine: next.selection.startLine,
            endLine: next.selection.endLine,
          }
        : undefined,
      // FORK: REQ-131 —— 接上原先被扔掉的两项 [feat: release-closeout-2026-09] 2026-09-17
      preview: meta?.preview,
      kind: meta?.kind,
    }
  }
}
