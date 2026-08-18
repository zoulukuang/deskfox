// [fork-only] REQ-084① 启动期迁移污染检查(历史遗留自愈)[feat: voice-preclear-batch] 2026-08-18
//
// 覆盖两类【迁移期检测挡不住】的存量:
//   ① 风险窗口开着期间(本功能上线前)已被迁进 deskfox ns 的污染 db —— marker 已写,迁移逻辑
//      再不会跑,不自愈就永久坏(每次启动 sidecar 都打不开同一个库);
//   ② 用户直接在 deskfox ns 上被另装的上游 opencode 迁超前的情形。
//
// 处置(D2 已拍板):挪走成 opencode.db.incompatible-<ts>(**保留不删**)→ core 以空库重起 → toast 告知。
// ⚠ 已知边界(D2 一并拍板接受):updater allowDowngrade=true 下,用户降级后自家新库也会判超前
//   而被隔离 —— 把「静默永久坏」换成「显式隔离、文件可手动恢复」,是设计内行为。
//
// 必须在 applyDeskfoxDataNamespace() 之后、spawn sidecar 之前调用(同 db-orphan-prune 的位置约束)。
//
// ⚠ dbPath 由调用方注入而非本模块解析:db-orphan-prune.ts(resolveSidecarDbPath 的家)顶层
//   import 了 node:sqlite,bun 连 resolve 都做不到 —— 引用它会让本模块的单测整个加载不了。
import { existsSync, readdirSync } from "node:fs"
import { basename, dirname } from "node:path"

import { write as writeLog } from "../logging"
import { assessJournal } from "./db-schema-guard"
import { quarantineDb, readJournalIds, type DbOpener } from "./db-schema-guard-io"
import { MIGRATION_BASELINE } from "./migration-baseline.generated"

export interface StartupCheckResult {
  /** 是否真的隔离了库(true 才需要 toast)。 */
  quarantined: boolean
  /** 被隔离的 db 文件名(不含目录)。 */
  dbName?: string
  /** 隔离文件所在目录 —— toast 要告诉用户去哪找回。 */
  dir?: string
  /** 隔离后产生的文件全名(db/-wal/-shm)。 */
  files: string[]
  reason: "ok" | "quarantined" | "no-db" | "quarantine-failed" | "error"
}

/**
 * 检查 sidecar 将要使用的库;判超前则隔离挪走。
 * **绝不抛** —— 启动路径上的旁路自愈,任何意外都只记日志放行(fail-open)。
 */
export function checkAndQuarantineAheadDb(dbPath: string, opener?: DbOpener): StartupCheckResult {
  try {
    const dir = dirname(dbPath)
    if (!existsSync(dbPath)) return { quarantined: false, files: [], dir, reason: "no-db" }

    const ids = opener ? readJournalIds(dbPath, opener) : readJournalIds(dbPath)
    const got = assessJournal(ids, MIGRATION_BASELINE)
    if (got.verdict !== "ahead") {
      // 绝大多数用户走这条:零写入、零改动
      return { quarantined: false, files: [], dir, reason: "ok" }
    }

    writeLog(
      "db-schema-guard",
      "启动期检测到数据库 schema 超前本内核,隔离后以空库启动",
      { dbPath, aheadCount: got.aheadIds.length, sample: got.aheadIds.slice(0, 3) },
      "warn",
    )
    const moved = quarantineDb(dbPath)
    if (!moved.moved) return { quarantined: false, files: [], dir, reason: "quarantine-failed" }
    return { quarantined: true, dbName: basename(dbPath), dir, files: moved.files, reason: "quarantined" }
  } catch (error) {
    writeLog("db-schema-guard", "启动期 schema 检查异常,放行启动", { error: String(error) }, "warn")
    return { quarantined: false, files: [], reason: "error" }
  }
}

/** 列出某目录下已隔离的库文件(给诊断 / 真机 QA 断言用)。 */
export function listQuarantinedDbs(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.includes(".incompatible-"))
      .sort()
  } catch {
    return []
  }
}
