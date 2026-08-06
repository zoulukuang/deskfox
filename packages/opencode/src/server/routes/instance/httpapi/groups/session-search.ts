// FORK-ONLY file: REQ-095 会话记录内容搜索 — /session/search 端点 schema 集中区
// [feat: session-content-search] 主调入口在 ./session.ts(FORK block)/ ../handlers/session.ts(FORK block)
// 模式先例:./file-office.ts(office-routes-effect-httpapi)

import { Schema } from "effect"
import { WorkspaceRoutingQueryFields } from "../middleware/workspace-routing"

export const SessionSearchQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  query: Schema.String,
  scope: Schema.optional(Schema.Literals(["project", "global"])),
  limit: Schema.optional(Schema.NumberFromString),
})

export const SessionSearchHit = Schema.Struct({
  sessionID: Schema.String,
  messageID: Schema.String,
  /** 命中所在轮次的 user 消息 id,前端 #message-<id> 锚点定位用 */
  anchorMessageID: Schema.String,
  partID: Schema.String,
  projectID: Schema.String,
  /** 'user' | 'assistant'(命中消息的角色) */
  kind: Schema.String,
  /** 含高亮定界符(U+E000 / U+E001)的片段 */
  snippet: Schema.String,
  timeCreated: Schema.Number,
  sessionTitle: Schema.String,
  directory: Schema.String,
  archived: Schema.optional(Schema.Boolean),
  projectName: Schema.optional(Schema.String),
  projectWorktree: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionSearchHit" })

export const SessionSearchResult = Schema.Struct({
  /** true = 当前环境 FTS 不可用(或底层查询异常),前端应隐藏「会话内容」分组 */
  unavailable: Schema.optional(Schema.Boolean),
  hits: Schema.Array(SessionSearchHit),
}).annotate({ identifier: "SessionSearchResult" })
