// FORK-ONLY file: REQ-095 会话记录内容搜索 — bootstrap + 查询执行 [feat: session-content-search]
//
// 不注册 Context.Service:handler 直接 yield* Database.Service 后调这里的普通 Effect 函数
// (先例:handlers/file.ts 直取 InstanceState.context;少动一处上游 layer 组装)。
// bootstrap 幂等 + 进程级闩:首次搜索时惰性执行 DDL + 增量 backfill;并发重复执行无害
// (全部 IF NOT EXISTS,SQLite 串行化)。

import { Effect } from "effect"
import { sql } from "drizzle-orm"
import type { Database } from "@opencode-ai/core/database/database"
import {
  BACKFILL_STATEMENT,
  CREATE_STATEMENTS,
  DROP_STATEMENTS,
  FTS_SCHEMA_VERSION,
  HL_END,
  HL_START,
  PROBE_STATEMENTS,
  READ_VERSION_STATEMENT,
  WRITE_VERSION_STATEMENT,
} from "./fts-sql"
import { makeSnippet, plan } from "./query"

type Db = Database.Interface["db"]

export type SearchHit = {
  sessionID: string
  messageID: string
  anchorMessageID: string
  partID: string
  projectID: string
  kind: string
  snippet: string
  timeCreated: number
  sessionTitle: string
  directory: string
  archived?: boolean
  projectName?: string
  projectWorktree?: string
}

export type SearchResult = {
  unavailable?: boolean
  hits: SearchHit[]
}

export type SearchInput = {
  query: string
  /** 传了 = 只搜该项目;不传 = 全局 */
  projectID?: string
  limit?: number
}

const HARD_CAP = 50
const DEFAULT_LIMIT = 20
/** 同轮次多 part 命中要按 (session, anchor) 去重,超采后截断 */
const OVERSAMPLE = 3

/** 进程级闩:undefined = 未探测;true/false = 已定 */
let readyState: boolean | undefined

/** 测试钩子:重置进程闩(仅测试用) */
export function resetForTest() {
  readyState = undefined
}

const probe = (db: Db) =>
  Effect.gen(function* () {
    for (const stmt of PROBE_STATEMENTS) yield* db.run(stmt)
    return true
  }).pipe(Effect.catchCause(() => Effect.succeed(false)))

const applySchema = (db: Db) =>
  Effect.gen(function* () {
    // meta 表先建,才能读版本
    yield* db.run(CREATE_STATEMENTS[0])
    const row = yield* db.get<{ value: string }>(READ_VERSION_STATEMENT)
    if (row && row.value !== FTS_SCHEMA_VERSION) {
      // schema 演进:整体重建(索引是派生数据,重建安全)
      for (const stmt of DROP_STATEMENTS) yield* db.run(stmt)
    }
    for (const stmt of CREATE_STATEMENTS) yield* db.run(stmt)
    // 增量 backfill:补触发器缺席期间(升级用户存量)漏掉的行;已索引库为近 no-op
    yield* db.run(BACKFILL_STATEMENT)
    yield* db.run(WRITE_VERSION_STATEMENT)
  })

/** 确保 FTS 就绪;返回可用性(false = 当前 SQLite 无 FTS5/trigram,search 走降级) */
export const ensure = Effect.fn("SessionSearch.ensure")(function* (db: Db) {
  if (readyState !== undefined) return readyState
  if (!(yield* probe(db))) {
    readyState = false
    yield* Effect.logWarning("session-search: FTS5 trigram unavailable, content search disabled")
    return false
  }
  yield* applySchema(db)
  readyState = true
  return true
})

type MatchRow = {
  part_id: string
  session_id: string
  message_id: string
  anchor_message_id: string
  project_id: string
  kind: string
  time_created: number
  session_title: string
  directory: string
  time_archived: number | null
  snippet: string
  score: number
}

type LikeRow = Omit<MatchRow, "snippet" | "score"> & { body: string; time_updated: number }

export const search = Effect.fn("SessionSearch.search")(function* (db: Db, input: SearchInput) {
  return yield* searchImpl(db, input).pipe(
    Effect.catchCause((cause) =>
      // 任何底层意外(上游表结构漂移等)不 500,降级为不可用并留日志
      Effect.logWarning("session-search: query failed, degrading", cause).pipe(
        Effect.as({ unavailable: true, hits: [] } satisfies SearchResult),
      ),
    ),
  )
})

const searchImpl = Effect.fn("SessionSearch.searchImpl")(function* (db: Db, input: SearchInput) {
  const parsed = plan(input.query)
  if (!parsed) return { hits: [] } satisfies SearchResult

  const available = yield* ensure(db)
  if (!available) return { unavailable: true, hits: [] } satisfies SearchResult

  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, HARD_CAP)
  const fetchLimit = limit * OVERSAMPLE
  const projectFilter = input.projectID ? sql` AND f.project_id = ${input.projectID}` : sql``

  let rows: (MatchRow | LikeRow)[]
  if (parsed.mode === "match") {
    rows = yield* db.all<MatchRow>(sql`
      SELECT f.part_id, f.session_id, f.message_id, f.anchor_message_id, f.project_id, f.kind,
             f.time_created,
             s.title AS session_title, s.directory AS directory, s.time_archived AS time_archived,
             snippet(session_fts_idx, 0, ${HL_START}, ${HL_END}, ${"…"}, 40) AS snippet,
             bm25(session_fts_idx) AS score
      FROM session_fts_idx
      JOIN session_fts f ON f.rowid = session_fts_idx.rowid
      JOIN session s ON s.id = f.session_id
      WHERE session_fts_idx MATCH ${parsed.match}
        AND s.parent_id IS NULL${projectFilter}
      ORDER BY score
      LIMIT ${fetchLimit}
    `)
  } else {
    rows = yield* db.all<LikeRow>(sql`
      SELECT f.part_id, f.session_id, f.message_id, f.anchor_message_id, f.project_id, f.kind,
             f.time_created, f.body AS body,
             s.title AS session_title, s.directory AS directory, s.time_archived AS time_archived,
             s.time_updated AS time_updated
      FROM session_fts f
      JOIN session s ON s.id = f.session_id
      WHERE s.parent_id IS NULL${projectFilter}
        AND ${sql.join(
          parsed.patterns.map((p) => sql`f.body LIKE ${p} ESCAPE '\\'`),
          sql` AND `,
        )}
      ORDER BY s.time_updated DESC, f.time_created DESC
      LIMIT ${fetchLimit}
    `)
  }

  // 按 (session, anchor_message) 去重:MATCH 已按 bm25 升序(越小越相关),LIKE 已按新→旧,取首见
  const seen = new Set<string>()
  const hits: SearchHit[] = []
  for (const row of rows) {
    const key = `${row.session_id}:${row.anchor_message_id}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push({
      sessionID: row.session_id,
      messageID: row.message_id,
      anchorMessageID: row.anchor_message_id,
      partID: row.part_id,
      projectID: row.project_id,
      kind: row.kind,
      snippet: "snippet" in row ? row.snippet : makeSnippet(row.body, parsed.tokens),
      timeCreated: row.time_created,
      sessionTitle: row.session_title,
      directory: row.directory,
      ...(row.time_archived ? { archived: true } : {}),
    })
    if (hits.length >= limit) break
  }

  // 补项目名(全局模式前端要显示所属项目;查一次 project 表,listGlobal 同款做法)
  const projectIDs = [...new Set(hits.map((h) => h.projectID).filter(Boolean))]
  if (projectIDs.length > 0) {
    const projects = yield* db.all<{ id: string; name: string | null; worktree: string }>(sql`
      SELECT id, name, worktree FROM project WHERE id IN (${sql.join(
        projectIDs.map((id) => sql`${id}`),
        sql`, `,
      )})
    `)
    const byID = new Map(projects.map((p) => [p.id, p]))
    for (const hit of hits) {
      const project = byID.get(hit.projectID)
      if (!project) continue
      if (project.name) hit.projectName = project.name
      hit.projectWorktree = project.worktree
    }
  }

  return { hits } satisfies SearchResult
})
