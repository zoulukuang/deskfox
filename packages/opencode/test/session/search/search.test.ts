// FORK-ONLY test: REQ-095 会话内容搜索 — 真 SQLite(:memory:)集成:bootstrap/触发器/查询语义
// [feat: session-content-search]
import { beforeEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import * as SessionSearch from "../../../src/session/search/search"
import { HL_END, HL_START } from "../../../src/session/search/fts-sql"
import { testEffect } from "../../lib/effect"

// 每个 test 一个全新 :memory: 库(layer per-test 构建),必须重置模块级进程闩,
// 否则第二个 test 直接跳过 bootstrap,新库没有 FTS 表。
const it = testEffect(Database.layerFromPath(":memory:"))
beforeEach(() => {
  SessionSearch.resetForTest()
})

type Db = Database.Interface["db"]

const PROJECT_A = "proj_a"
const PROJECT_B = "proj_b"

const seedProjects = (db: Db) =>
  Effect.gen(function* () {
    yield* db
      .insert(ProjectTable)
      .values([
        { id: PROJECT_A, worktree: "/work/a", sandboxes: [], name: "项目A" },
        { id: PROJECT_B, worktree: "/work/b", sandboxes: [], name: "项目B" },
      ] as never)
      .run()
      .pipe(Effect.orDie)
  })

const seedSession = (
  db: Db,
  input: { id: string; projectID: string; title?: string; parentID?: string; archived?: number },
) =>
  db
    .insert(SessionTable)
    .values({
      id: input.id,
      project_id: input.projectID,
      parent_id: input.parentID,
      slug: input.id,
      directory: input.projectID === PROJECT_A ? "/work/a" : "/work/b",
      title: input.title ?? `标题-${input.id}`,
      version: "0",
      time_created: 1000,
      time_updated: 2000,
      time_archived: input.archived,
    } as never)
    .run()
    .pipe(Effect.orDie)

const seedMessage = (db: Db, input: { id: string; sessionID: string; role: "user" | "assistant"; time?: number }) =>
  db
    .insert(MessageTable)
    .values({
      id: input.id,
      session_id: input.sessionID,
      time_created: input.time ?? 1000,
      time_updated: input.time ?? 1000,
      data: { role: input.role } as never,
    } as never)
    .run()
    .pipe(Effect.orDie)

const seedPart = (
  db: Db,
  input: {
    id: string
    messageID: string
    sessionID: string
    text: string
    time?: number
    type?: string
    synthetic?: boolean
    ignored?: boolean
  },
) =>
  db
    .insert(PartTable)
    .values({
      id: input.id,
      message_id: input.messageID,
      session_id: input.sessionID,
      time_created: input.time ?? 1500,
      time_updated: input.time ?? 1500,
      data: {
        type: input.type ?? "text",
        text: input.text,
        ...(input.synthetic ? { synthetic: true } : {}),
        ...(input.ignored ? { ignored: true } : {}),
      } as never,
    } as never)
    .run()
    .pipe(Effect.orDie)

/** 常用底座:项目A 一个 root 会话 + user/assistant 各一条消息 */
const seedBasic = (db: Db) =>
  Effect.gen(function* () {
    yield* seedProjects(db)
    yield* seedSession(db, { id: "ses_1", projectID: PROJECT_A, title: "调试会话" })
    yield* seedMessage(db, { id: "msg_01user", sessionID: "ses_1", role: "user", time: 1100 })
    yield* seedMessage(db, { id: "msg_02assist", sessionID: "ses_1", role: "assistant", time: 1200 })
  })

describe("SessionSearch(集成)", () => {
  // I1 + U10:backfill 索引存量数据,中文 trigram 子串命中(MATCH 路径)
  it.effect("backfill 后中文子串命中(≥3 字走 MATCH,含高亮片段)", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      // 先插 part(触发器尚未创建)→ 首次 search 的 bootstrap backfill 应补上
      yield* seedPart(db, { id: "prt_1", messageID: "msg_02assist", sessionID: "ses_1", text: "编译报错信息在此处" })
      const result = yield* SessionSearch.search(db, { query: "报错信息", projectID: PROJECT_A })
      expect(result.unavailable).toBeUndefined()
      expect(result.hits.length).toBe(1)
      const hit = result.hits[0]
      expect(hit.sessionID).toBe("ses_1")
      expect(hit.messageID).toBe("msg_02assist")
      expect(hit.sessionTitle).toBe("调试会话")
      expect(hit.directory).toBe("/work/a")
      expect(hit.kind).toBe("assistant")
      expect(hit.snippet).toContain(HL_START)
      expect(hit.snippet).toContain(HL_END)
      expect(hit.snippet).toContain("报错信息")
    }),
  )

  // U2:1–2 字查询走 LIKE 路径,同样命中 + TS 侧 snippet
  it.effect("双字中文查询走 LIKE 回退,命中并打高亮", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      yield* seedPart(db, { id: "prt_1", messageID: "msg_02assist", sessionID: "ses_1", text: "编译报错信息在此处" })
      const result = yield* SessionSearch.search(db, { query: "报错", projectID: PROJECT_A })
      expect(result.hits.length).toBe(1)
      expect(result.hits[0].snippet).toContain(`${HL_START}报错${HL_END}`)
    }),
  )

  // U5(增量):bootstrap 之后新插入的 part 由触发器即时入索引
  it.effect("触发器增量:新消息落库后立即可搜", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      // 先空搜一把,完成 bootstrap(建表+触发器)
      const empty = yield* SessionSearch.search(db, { query: "独特词汇", projectID: PROJECT_A })
      expect(empty.hits.length).toBe(0)
      yield* seedPart(db, { id: "prt_new", messageID: "msg_02assist", sessionID: "ses_1", text: "含独特词汇的回复" })
      const result = yield* SessionSearch.search(db, { query: "独特词汇", projectID: PROJECT_A })
      expect(result.hits.length).toBe(1)
    }),
  )

  // U5(update/delete):part 更新/删除后索引随动
  it.effect("part 更新与删除后索引随动", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      yield* SessionSearch.search(db, { query: "warmup", projectID: PROJECT_A })
      yield* seedPart(db, { id: "prt_1", messageID: "msg_02assist", sessionID: "ses_1", text: "旧版本内容甲乙丙" })
      // 更新正文
      yield* db
        .run(`UPDATE part SET data = json_set(data, '$.text', '新版本内容丁戊己') WHERE id = 'prt_1'`)
        .pipe(Effect.orDie)
      const stale = yield* SessionSearch.search(db, { query: "甲乙丙", projectID: PROJECT_A })
      expect(stale.hits.length).toBe(0)
      const fresh = yield* SessionSearch.search(db, { query: "丁戊己", projectID: PROJECT_A })
      expect(fresh.hits.length).toBe(1)
      // 删除
      yield* db.run(`DELETE FROM part WHERE id = 'prt_1'`).pipe(Effect.orDie)
      const gone = yield* SessionSearch.search(db, { query: "丁戊己", projectID: PROJECT_A })
      expect(gone.hits.length).toBe(0)
    }),
  )

  // U5(过滤):非 text / synthetic / ignored 不入索引
  it.effect("非 text、synthetic、ignored part 不入索引", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      yield* SessionSearch.search(db, { query: "warmup", projectID: PROJECT_A })
      yield* seedPart(db, {
        id: "prt_r",
        messageID: "msg_02assist",
        sessionID: "ses_1",
        text: "思考排除词",
        type: "reasoning",
      })
      yield* seedPart(db, {
        id: "prt_s",
        messageID: "msg_02assist",
        sessionID: "ses_1",
        text: "合成排除词",
        synthetic: true,
      })
      yield* seedPart(db, {
        id: "prt_i",
        messageID: "msg_02assist",
        sessionID: "ses_1",
        text: "忽略排除词",
        ignored: true,
      })
      for (const query of ["思考排除词", "合成排除词", "忽略排除词"]) {
        const result = yield* SessionSearch.search(db, { query, projectID: PROJECT_A })
        expect(result.hits.length).toBe(0)
      }
    }),
  )

  // U6:anchor 语义
  it.effect("assistant 命中锚定所在轮 user 消息;user 命中锚定自身;无前置 user 回退自身", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      yield* seedPart(db, { id: "prt_u", messageID: "msg_01user", sessionID: "ses_1", text: "用户问题甲甲甲" })
      yield* seedPart(db, { id: "prt_a", messageID: "msg_02assist", sessionID: "ses_1", text: "助手回复乙乙乙" })
      const assistantHit = yield* SessionSearch.search(db, { query: "乙乙乙", projectID: PROJECT_A })
      expect(assistantHit.hits[0].anchorMessageID).toBe("msg_01user")
      const userHit = yield* SessionSearch.search(db, { query: "甲甲甲", projectID: PROJECT_A })
      expect(userHit.hits[0].anchorMessageID).toBe("msg_01user")
      // 无前置 user 消息:另开会话只有 assistant
      yield* seedSession(db, { id: "ses_2", projectID: PROJECT_A })
      yield* seedMessage(db, { id: "msg_10assist", sessionID: "ses_2", role: "assistant" })
      yield* seedPart(db, { id: "prt_b", messageID: "msg_10assist", sessionID: "ses_2", text: "孤儿回复丙丙丙" })
      const orphan = yield* SessionSearch.search(db, { query: "丙丙丙", projectID: PROJECT_A })
      expect(orphan.hits[0].anchorMessageID).toBe("msg_10assist")
    }),
  )

  // I1:scope 过滤 / 全局模式带项目信息
  it.effect("项目过滤与全局模式(带项目名)", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      yield* seedSession(db, { id: "ses_b", projectID: PROJECT_B })
      yield* seedMessage(db, { id: "msg_b1", sessionID: "ses_b", role: "user" })
      yield* seedPart(db, { id: "prt_a1", messageID: "msg_01user", sessionID: "ses_1", text: "共同关键词条目" })
      yield* seedPart(db, { id: "prt_b1", messageID: "msg_b1", sessionID: "ses_b", text: "共同关键词条目" })
      const scoped = yield* SessionSearch.search(db, { query: "共同关键词", projectID: PROJECT_A })
      expect(scoped.hits.length).toBe(1)
      expect(scoped.hits[0].projectID).toBe(PROJECT_A)
      const global = yield* SessionSearch.search(db, { query: "共同关键词" })
      expect(global.hits.length).toBe(2)
      const names = global.hits.map((h) => h.projectName).sort()
      expect(names).toEqual(["项目A", "项目B"])
    }),
  )

  // I1:只搜 root 会话;archived 含且带标记
  it.effect("子会话排除,archived 会话保留并标记", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      // 子会话
      yield* seedSession(db, { id: "ses_child", projectID: PROJECT_A, parentID: "ses_1" })
      yield* seedMessage(db, { id: "msg_c1", sessionID: "ses_child", role: "user" })
      yield* seedPart(db, { id: "prt_c1", messageID: "msg_c1", sessionID: "ses_child", text: "子会话专属词汇" })
      const child = yield* SessionSearch.search(db, { query: "子会话专属", projectID: PROJECT_A })
      expect(child.hits.length).toBe(0)
      // archived
      yield* seedSession(db, { id: "ses_arch", projectID: PROJECT_A, archived: 3000 })
      yield* seedMessage(db, { id: "msg_ar1", sessionID: "ses_arch", role: "user" })
      yield* seedPart(db, { id: "prt_ar1", messageID: "msg_ar1", sessionID: "ses_arch", text: "归档会话专属词汇" })
      const archived = yield* SessionSearch.search(db, { query: "归档会话专属", projectID: PROJECT_A })
      expect(archived.hits.length).toBe(1)
      expect(archived.hits[0].archived).toBe(true)
    }),
  )

  // D6:同轮次多 part 命中去重
  it.effect("同一轮次多个命中 part 去重为一条", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      yield* seedPart(db, { id: "prt_1", messageID: "msg_01user", sessionID: "ses_1", text: "重复词条第一段" })
      yield* seedPart(db, { id: "prt_2", messageID: "msg_02assist", sessionID: "ses_1", text: "重复词条第二段" })
      const result = yield* SessionSearch.search(db, { query: "重复词条", projectID: PROJECT_A })
      expect(result.hits.length).toBe(1)
    }),
  )

  // U7:bootstrap 幂等(连续两次 ensure + 重复 backfill 不重不错)
  it.effect("bootstrap 幂等:重复 ensure 不报错不重复索引", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      yield* seedPart(db, { id: "prt_1", messageID: "msg_01user", sessionID: "ses_1", text: "幂等测试词汇" })
      yield* SessionSearch.search(db, { query: "幂等测试", projectID: PROJECT_A })
      SessionSearch.resetForTest() // 模拟进程重启:再走一遍完整 bootstrap(含 backfill)
      const again = yield* SessionSearch.search(db, { query: "幂等测试", projectID: PROJECT_A })
      expect(again.hits.length).toBe(1)
      const count = yield* db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM session_fts`).pipe(Effect.orDie)
      expect(count?.n).toBe(1)
    }),
  )

  // U7(版本演进):meta 版本不匹配 → 重建后仍可搜
  it.effect("schema 版本不匹配时整体重建", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      yield* seedPart(db, { id: "prt_1", messageID: "msg_01user", sessionID: "ses_1", text: "版本重建词汇" })
      yield* SessionSearch.search(db, { query: "版本重建", projectID: PROJECT_A })
      yield* db.run(`UPDATE session_fts_meta SET value = '0' WHERE key = 'schema_version'`).pipe(Effect.orDie)
      SessionSearch.resetForTest()
      const result = yield* SessionSearch.search(db, { query: "版本重建", projectID: PROJECT_A })
      expect(result.hits.length).toBe(1)
      const version = yield* db
        .get<{ value: string }>(`SELECT value FROM session_fts_meta WHERE key = 'schema_version'`)
        .pipe(Effect.orDie)
      expect(version?.value).toBe("1")
    }),
  )

  // U9:FTS 探测失败降级
  it.effect("FTS 不可用时优雅降级为 unavailable", () =>
    Effect.gen(function* () {
      const broken = {
        run: () => Effect.fail(new Error("no fts5")),
        all: () => Effect.fail(new Error("no fts5")),
        get: () => Effect.fail(new Error("no fts5")),
      } as unknown as Database.Interface["db"]
      const result = yield* SessionSearch.search(broken, { query: "任意词汇" })
      expect(result.unavailable).toBe(true)
      expect(result.hits).toEqual([])
    }),
  )

  // P1:万级消息规模,MATCH 与 LIKE 双路径均 < 1s(backfill 一次性成本不计入)
  it.effect("万级消息规模搜索响应 < 1s", () =>
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seedBasic(db)
      yield* db
        .run(
          `WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 10000)
           INSERT INTO part(id, message_id, session_id, time_created, time_updated, data)
           SELECT 'prt_bulk_' || i, 'msg_02assist', 'ses_1', 1500, 1500,
                  json_object('type', 'text', 'text', '第' || i || '条填充消息正文内容用于规模压测场景')
           FROM seq`,
        )
        .pipe(Effect.orDie)
      // 首搜触发 bootstrap + 10k backfill(一次性成本,不计入查询延迟)
      yield* SessionSearch.search(db, { query: "预热词汇", projectID: PROJECT_A })
      const t0 = performance.now()
      const match = yield* SessionSearch.search(db, { query: "填充消息", projectID: PROJECT_A })
      const matchMs = performance.now() - t0
      const t1 = performance.now()
      const like = yield* SessionSearch.search(db, { query: "压测", projectID: PROJECT_A })
      const likeMs = performance.now() - t1
      expect(match.hits.length).toBeGreaterThan(0)
      expect(like.hits.length).toBeGreaterThan(0)
      expect(matchMs).toBeLessThan(1000)
      expect(likeMs).toBeLessThan(1000)
    }),
  )

  // U1 边界:无有效 token 直接空结果,不触碰 DB
  it.effect("纯标点查询返回空且不触发 bootstrap", () =>
    Effect.gen(function* () {
      const untouched = {
        run: () => Effect.die("should not touch db"),
        all: () => Effect.die("should not touch db"),
        get: () => Effect.die("should not touch db"),
      } as unknown as Database.Interface["db"]
      const result = yield* SessionSearch.search(untouched, { query: "!!!" })
      expect(result.hits).toEqual([])
      expect(result.unavailable).toBeUndefined()
    }),
  )
})
