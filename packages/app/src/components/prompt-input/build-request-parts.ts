import { getFilename } from "@opencode-ai/core/util/path"
import { type AgentPartInput, type FilePartInput, type Part, type TextPartInput } from "@opencode-ai/sdk/v2/client"
import type { FileSelection } from "@/context/file"
import { encodeFilePath } from "@/context/file/path"
import type { AgentPart, FileAttachmentPart, ImageAttachmentPart, Prompt } from "@/context/prompt"
import { Identifier } from "@/utils/id"
import { createCommentMetadata, formatCommentNote } from "@/utils/comment-note"

type PromptRequestPart = (TextPartInput | FilePartInput | AgentPartInput) & { id: string }

type ContextFile = {
  key: string
  type: "file"
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  // FORK: 从 Tauri 迁回 quote 子分类 + chat 引用 kind [feat: 聊天选区-卡片化-换行] 2026-06-14
  commentOrigin?: "review" | "file" | "quote"
  preview?: string
  kind?: "chat" | "file"
}

type BuildRequestPartsInput = {
  prompt: Prompt
  context: ContextFile[]
  images: (Omit<ImageAttachmentPart, "blob"> & { dataUrl: string })[]
  text: string
  messageID: string
  sessionID: string
  sessionDirectory: string
}

const absolute = (directory: string, path: string) => {
  if (path.startsWith("/")) return path
  if (/^[A-Za-z]:[\\/]/.test(path) || /^[A-Za-z]:$/.test(path)) return path
  if (path.startsWith("\\\\") || path.startsWith("//")) return path
  return `${directory.replace(/[\\/]+$/, "")}/${path}`
}

const fileQuery = (selection: FileSelection | undefined) =>
  selection ? `?start=${selection.startLine}&end=${selection.endLine}` : ""

const mention = /(^|[\s([{"'])@(\S+)/g

const parseCommentMentions = (comment: string) => {
  return Array.from(comment.matchAll(mention)).flatMap((match) => {
    const path = (match[2] ?? "").replace(/[.,!?;:)}\]"']+$/, "")
    if (!path) return []
    return [path]
  })
}

const isFileAttachment = (part: Prompt[number]): part is FileAttachmentPart => part.type === "file"
const isAgentAttachment = (part: Prompt[number]): part is AgentPart => part.type === "agent"

const toOptimisticPart = (part: PromptRequestPart, sessionID: string, messageID: string): Part => {
  if (part.type === "text") {
    return {
      id: part.id,
      type: "text",
      text: part.text,
      synthetic: part.synthetic,
      ignored: part.ignored,
      time: part.time,
      metadata: part.metadata,
      sessionID,
      messageID,
    }
  }
  if (part.type === "file") {
    return {
      id: part.id,
      type: "file",
      mime: part.mime,
      filename: part.filename,
      url: part.url,
      source: part.source,
      sessionID,
      messageID,
    }
  }
  return {
    id: part.id,
    type: "agent",
    name: part.name,
    source: part.source,
    sessionID,
    messageID,
  }
}

export function buildRequestParts(input: BuildRequestPartsInput) {
  const requestParts: PromptRequestPart[] = input.text.trim()
    ? [
        {
          id: Identifier.ascending("part"),
          type: "text",
          text: input.text,
        },
      ]
    : []

  const files = input.prompt.filter(isFileAttachment).map((attachment) => {
    const path = absolute(input.sessionDirectory, attachment.path)
    const source = attachment.source
      ? {
          ...attachment.source,
          text: {
            value: attachment.content,
            start: attachment.start,
            end: attachment.end,
          },
        }
      : {
          type: "file" as const,
          text: {
            value: attachment.content,
            start: attachment.start,
            end: attachment.end,
          },
          path,
        }
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: attachment.mime ?? "text/plain",
      url: attachment.url ?? `file://${encodeFilePath(path)}${fileQuery(attachment.selection)}`,
      filename: attachment.filename ?? getFilename(attachment.path),
      source,
    } satisfies PromptRequestPart
  })

  const agents = input.prompt.filter(isAgentAttachment).map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "agent",
      name: attachment.name,
      source: {
        value: attachment.content,
        start: attachment.start,
        end: attachment.end,
      },
    } satisfies PromptRequestPart
  })

  const used = new Set(files.map((part) => part.url))
  // FORK: REQ-065 — 选区/引用卡按 commentID 去重(每张卡有唯一 commentID),与整文件 url 去重分属两个命名空间,
  // 避免同文件多卡(不同 commentID)被旧的"按 url+有无comment"口径误并成一张。2026-06-17
  const usedComments = new Set<string>()
  const context = input.context.flatMap((item) => {
    const path = absolute(input.sessionDirectory, item.path)
    const url = `file://${encodeFilePath(path)}${fileQuery(item.selection)}`
    const comment = item.comment?.trim()
    const preview = item.preview?.trim()
    const commentID = item.commentID

    // FORK: REQ-065 去重分流 —
    //  · 有 commentID(选区/引用卡):按 commentID 去重,同文件多张不同卡全部保留;不写入 url 集,避免污染整文件去重。
    //  · 无 commentID(整文件引用):仍按 url 去重,保留"prompt 已 @mention 同路径则丢无评论重复卡"的原行为。
    if (commentID) {
      if (usedComments.has(commentID)) return []
      usedComments.add(commentID)
    } else {
      if (!comment && used.has(url)) return []
      used.add(url)
    }

    const filePart = {
      id: Identifier.ascending("part"),
      type: "file",
      mime: "text/plain",
      url,
      filename: getFilename(item.path),
    } satisfies PromptRequestPart

    // FORK: REQ-065 + md-token — 仅"无评论且无可发内容"的纯整文件卡退化为单 filePart;
    // 选区卡(有 commentID + preview)即使无评论也发 {选中文字 preview + 文件 URL(行范围)},
    // 不退化为整文件,避免大 .md 整文件灌进上下文浪费 token、且保证选中文字真正到达模型。2026-06-17
    if (!comment && !preview) return [filePart]

    const mentions = comment
      ? parseCommentMentions(comment).flatMap((path) => {
          const url = `file://${encodeFilePath(absolute(input.sessionDirectory, path))}`
          if (used.has(url)) return []
          used.add(url)
          return [
            {
              id: Identifier.ascending("part"),
              type: "file",
              mime: "text/plain",
              url,
              filename: getFilename(path),
            } satisfies PromptRequestPart,
          ]
        })
      : []

    return [
      {
        id: Identifier.ascending("part"),
        type: "text",
        // FORK: 传 preview + kind,kind="chat" 走聊天引用模板(从 Tauri 迁回)[feat: 聊天选区-卡片化-换行] 2026-06-14
        text: formatCommentNote({
          path: item.path,
          selection: item.selection,
          comment: comment ?? "",
          preview: item.preview,
          kind: item.kind,
        }),
        synthetic: true,
        metadata: createCommentMetadata({
          path: item.path,
          selection: item.selection,
          comment: comment ?? "",
          preview: item.preview,
          origin: item.commentOrigin,
          kind: item.kind,
        }),
      } satisfies PromptRequestPart,
      filePart,
      ...mentions,
    ]
  })

  const images = input.images.map((attachment) => {
    return {
      id: Identifier.ascending("part"),
      type: "file",
      mime: attachment.mime,
      url: attachment.dataUrl,
      filename: attachment.sourcePath ?? attachment.filename,
    } satisfies PromptRequestPart
  })

  requestParts.push(...files, ...context, ...agents, ...images)

  return {
    requestParts,
    optimisticParts: requestParts.map((part) => toOptimisticPart(part, input.sessionID, input.messageID)),
  }
}
