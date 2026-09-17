// FORK-ONLY: REQ-125 会话标题剥壳的注入适配层
// [feat: release-closeout-2026-09] 2026-09-17
//
// ensureTitle 把首条 user 消息**原样**喂给 title agent。当这条消息是「加入聊天」发起的引用注释时,
// 它其实是一层英文样板包着用户真正写的那句话,于是小模型只看见样板,
// 所有这样发起的会话标题都变成同一句 `User Made Following Comment Regarding File`
// (中文提问也出英文标题 —— title.txt 要求"跟随用户消息语言",而它看到的语言是英文)。
//
// 本文件只做一件事:在喂模型前,把模型消息里那层样板换成用户真写的内容。
// 剥壳规则本身住在 @opencode-ai/core/fork/comment-note —— 它必须跟模板贴身同住,
// 否则改了模板忘了改正则,标题会静默退回英文样板且没有任何报错。
//
// 只影响 ensureTitle 这一条路径:主模型拿到的 prompt 一个字不变(它需要完整的引用上下文)。

import { stripCommentNoteForTitle } from "@opencode-ai/core/fork/comment-note"

type TextLike = { type?: unknown; text?: unknown }
type MessageLike = { role?: unknown; content?: unknown }

function unwrapText(text: string) {
  return stripCommentNoteForTitle(text) ?? text
}

/**
 * 把消息数组里 user 消息的引用注释样板剥掉,其余原样返回。
 *
 * 泛型直通:不改变调用方看到的类型,prompt.ts 那边只多一行。
 * 非模板内容 `stripCommentNoteForTitle` 返回 undefined,此处回落原文 —— 普通消息不受影响。
 */
export function unwrapCommentNotesForTitle<T>(messages: readonly T[]): T[] {
  return messages.map((message) => {
    const value = message as MessageLike
    if (value?.role !== "user") return message
    if (typeof value.content === "string") {
      return { ...value, content: unwrapText(value.content) } as T
    }
    if (!Array.isArray(value.content)) return message
    return {
      ...value,
      content: value.content.map((part: TextLike) =>
        part?.type === "text" && typeof part.text === "string" ? { ...part, text: unwrapText(part.text) } : part,
      ),
    } as T
  })
}
