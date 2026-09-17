// FORK: 引用注释模板/解析器已上移到 packages/core/src/fork/comment-note.ts 作为前后端唯一真源
// (REQ-125 需要服务端 ensureTitle 也能剥壳;照抄一份会让模板与正则分居两地、静默失配)。
// 本文件保留为 re-export,调用方 import 路径一处未改。
// [feat: release-closeout-2026-09] 2026-09-17
export {
  createCommentMetadata,
  readCommentMetadata,
  formatCommentNote,
  parseCommentNote,
  type PromptComment,
  type CommentSelection,
} from "@opencode-ai/core/fork/comment-note"
