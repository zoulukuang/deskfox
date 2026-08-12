// [fork-only] 存量库孤儿 project_directory 行清理 —— 实操层 [feat: db-orphan-prune] 2026-08-12
//
// 背景、根因与「为什么不改上游那条迁移」见同目录 db-orphan-prune-sql.ts 文件头。
// 一句话:上游迁移 20260612174303 会因孤儿行撞外键而失败,导致 sidecar 起不来、应用完全打不开;
// 本模块在 spawn sidecar **之前**把孤儿行清掉,让那条迁移自然通过。零改上游。
//
// 本文件只做「打开库 / 查 / 删」这层薄操作;所有 SQL 与判定分支都在 -sql.ts 里(纯逻辑,已单测)。
// 这样拆是因为 node:sqlite 在 bun 测试环境加载即报 "No such built-in module",
// 纯逻辑必须与它隔离才测得到(同 menu-role-label 的 helper extract 模式)。
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { DatabaseSync } from "node:sqlite"

import { CHANNEL } from "../constants"
import { write as writeLog } from "../logging"
import { SQL, TARGET_MIGRATION_ID, MIGRATION_TABLE, decidePrune, resolveDbFileName } from "./db-orphan-prune-sql"

export interface PruneResult {
  acted: boolean
  reason?: string
  orphans?: number
  dbPath?: string
}

/**
 * 解析 sidecar 实际使用的库路径。
 * 必须在 applyDeskfoxDataNamespace() **之后**调用 —— 它会把 XDG_DATA_HOME 指向 deskfox 专属根,
 * sidecar 继承同一份 env,两边看到的是同一个库。
 */
export function resolveSidecarDbPath(packaged: boolean): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share", "deskfox")
  return join(dataHome, "opencode", resolveDbFileName({ channel: CHANNEL, packaged }))
}

/**
 * 清理孤儿行。**绝不抛异常** —— 这是启动路径上的旁路修复,
 * 任何意外(库被锁、表结构不符、权限)都只记日志放行,不能反过来把应用挡在门外。
 */
export function pruneOrphanProjectDirectories(packaged: boolean): PruneResult {
  let db: DatabaseSync | undefined
  try {
    const dbPath = resolveSidecarDbPath(packaged)
    if (!existsSync(dbPath)) {
      return { acted: false, reason: "db-missing", dbPath }
    }

    db = new DatabaseSync(dbPath)

    const hasTable = (name: string) => !!db!.prepare(SQL.tableExists).get(name)
    const hasMigrationTable = hasTable(MIGRATION_TABLE)
    const migrationDone =
      hasMigrationTable && !!db.prepare(SQL.migrationDone).get(TARGET_MIGRATION_ID)

    const hasProjectDirectoryTable = hasTable("project_directory")
    const hasProjectTable = hasTable("project")

    let orphanCount = 0
    if (!migrationDone && hasProjectDirectoryTable && hasProjectTable) {
      const row = db.prepare(SQL.countOrphans).get() as { c?: number } | undefined
      orphanCount = Number(row?.c ?? 0)
    }

    const decision = decidePrune({
      dbExists: true,
      migrationDone,
      hasProjectDirectoryTable,
      hasProjectTable,
      orphanCount,
    })

    if (!decision.act) {
      // 绝大多数用户走这条(无孤儿 / 已迁移),零写入
      return { acted: false, reason: decision.reason, dbPath }
    }

    db.exec("BEGIN")
    try {
      db.exec(SQL.deleteOrphans)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    writeLog("db-orphan-prune", "pruned orphan project_directory rows before sidecar start", {
      orphans: decision.orphans,
      dbPath,
      why: `上游迁移 ${TARGET_MIGRATION_ID} 会因这些行撞外键而失败,导致 sidecar 起不来`,
    })
    return { acted: true, orphans: decision.orphans, dbPath }
  } catch (error) {
    // 不阻断启动:清理失败最坏只是回到「原本就会失败」的状态,不该额外制造故障
    writeLog("db-orphan-prune", "orphan prune skipped due to error", { error: String(error) }, "warn")
    return { acted: false, reason: "error" }
  } finally {
    try {
      db?.close()
    } catch {
      // ignore
    }
  }
}
