// FORK-ONLY: REQ-100 ④ 引用卡片回吐的字段映射(纯逻辑)
// [feat: release-closeout-2026-09] 2026-09-17
//
// 发送失败时要把引用卡片原样还回输入框。原实现内联在 submit.ts 的闭包里,且**漏传 `kind`** ——
// 聊天引用(kind:"chat")回吐后降级成文件引用,用户再发一次时 formatCommentNote 走的是
// 文件引用模板而不是聊天引用模板,引文的"来自本次对话"这层语义当场丢失,而界面上看不出来。
//
// 抽成纯函数只为一件事:让"有没有漏字段"这种事能被一条单测钉死,而不是靠人眼比对两个对象字面量。
// 将来 ContextItem 再加字段,补在这里 + 补一条断言即可。

import type { ContextItem } from "@/context/prompt"

export type CommentRestoreInput = Pick<
  ContextItem,
  "path" | "selection" | "comment" | "commentID" | "commentOrigin" | "preview" | "kind"
>

export function commentRestorePayload(item: CommentRestoreInput) {
  return {
    type: "file" as const,
    path: item.path,
    selection: item.selection,
    comment: item.comment,
    commentID: item.commentID,
    commentOrigin: item.commentOrigin,
    preview: item.preview,
    kind: item.kind,
  }
}
