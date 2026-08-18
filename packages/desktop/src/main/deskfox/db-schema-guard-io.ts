// [fork-only] REQ-084① 迁移污染检测 — IO 壳 [feat: voice-preclear-batch] 2026-08-18
//
// 判定逻辑在 db-schema-guard.ts(纯函数,已单测);本文件只做「只读打开库 / 读 journal / 隔离挪档」。
//
// ⚠ 为什么 driver 要注入、且 node:sqlite 必须【惰性】加载:
//   bun 无法 resolve "node:sqlite"(顶层 import 直接报 Could not resolve,连测试文件都加载不了),
//   与 db-orphan-prune.ts 记录的是同一个坑。所以:
//     - 顶层不 import node:sqlite,prod opener 内用 createRequire 现取;
//     - readJournalIds 的 opener 可注入,单测注入 bun:sqlite → 同一份逻辑在两个 runtime 下都测得到。
//   T7 spike 已验证 bun:sqlite 造的库能被 node:sqlite 只读读通(含数据只在 -wal 里的情形)。
import { existsSync, renameSync } from "node:fs"
import { createRequire } from "node:module"

import { write as writeLog } from "../logging"

/** 只读库的最小接口 —— 够读 journal 就行,不暴露写能力。 */
export interface ReadonlyDb {
  all(sql: string): Array<Record<string, unknown>>
  close(): void
}
export type DbOpener = (path: string) => ReadonlyDb

const MIGRATION_TABLE = "migration"
const LEGACY_TABLE = "__drizzle_migrations"

const SQL = {
  tableExists: `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('${MIGRATION_TABLE}','${LEGACY_TABLE}')`,
  readMigration: `SELECT id FROM ${MIGRATION_TABLE}`,
  readLegacy: `SELECT name FROM ${LEGACY_TABLE}`,
}

/**
 * prod opener:node:sqlite 只读打开。
 * readOnly 是硬要求 —— 检测发生在用户数据上,绝不允许因为"顺手打开"而写坏/升级用户的库。
 * (T7 spike 实测:只读句柄写入会被拒 `attempt to write a readonly database`。)
 */
export function openWithNodeSqlite(path: string): ReadonlyDb {
  const require = createRequire(import.meta.url)
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite")
  const db = new DatabaseSync(path, { readOnly: true })
  return {
    all: (sql: string) => db.prepare(sql).all() as Array<Record<string, unknown>>,
    close: () => db.close(),
  }
}

/**
 * T3:读迁移 journal 的 id 清单。
 * - `migration` 表优先;缺它则回落 legacy `__drizzle_migrations.name`(老库,core 会 seed 过去)。
 * - 库不存在 / 打不开 / 文件损坏 / 两张表都没有 → 返回 null(= 无法判断),**绝不抛**。
 *   上游 assessJournal 会把 null 判成 unknown 走 fail-open —— 检测不能反过来把好库拦下。
 */
export function readJournalIds(dbPath: string, open: DbOpener = openWithNodeSqlite): string[] | null {
  if (!existsSync(dbPath)) return null
  let db: ReadonlyDb | undefined
  try {
    db = open(dbPath)
    const tables = new Set(db.all(SQL.tableExists).map((r) => String(r.name)))
    if (tables.has(MIGRATION_TABLE)) {
      return db.all(SQL.readMigration).map((r) => String(r.id))
    }
    if (tables.has(LEGACY_TABLE)) {
      return db.all(SQL.readLegacy).map((r) => String(r.name))
    }
    return null
  } catch (error) {
    // 损坏文件 / 权限 / 锁 —— 一律当"读不出",放行。
    writeLog("db-schema-guard", "读取 migration journal 失败,按未知放行", { dbPath, error: String(error) }, "warn")
    return null
  } finally {
    try {
      db?.close()
    } catch {
      // ignore
    }
  }
}

export interface QuarantineResult {
  moved: boolean
  /** 实际挪走的文件(db 本体 + 可能的 -wal/-shm)。 */
  files: string[]
  suffix?: string
  error?: string
}

/**
 * 把判定为超前的库挪开(**保留不删**,用户可手动恢复),让 core 以空库重新起。
 * db 本体 + -wal + -shm 必须一起挪:只挪本体会留下孤儿 wal,SQLite 再开新库时可能被误用。
 * 失败不抛 —— 挪不动最坏是回到"原本就打不开"的状态,不该额外制造启动故障。
 */
export function quarantineDb(dbPath: string, stamp: string = timestamp()): QuarantineResult {
  const suffix = `.incompatible-${stamp}`
  const files: string[] = []
  try {
    if (!existsSync(dbPath)) return { moved: false, files: [] }
    for (const src of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      if (!existsSync(src)) continue
      renameSync(src, src + suffix)
      files.push(src + suffix)
    }
    writeLog("db-schema-guard", "已隔离超前 schema 的数据库(保留文件,可手动恢复)", { dbPath, suffix, files })
    return { moved: files.length > 0, files, suffix }
  } catch (error) {
    writeLog("db-schema-guard", "隔离超前数据库失败,放行启动", { dbPath, error: String(error) }, "warn")
    return { moved: false, files, error: String(error) }
  }
}

/** `YYYYMMDDHHmmss` 本地时间戳,给隔离文件名用(可读、可排序)。 */
export function timestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
