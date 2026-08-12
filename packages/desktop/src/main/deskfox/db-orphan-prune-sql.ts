// [fork-only] 存量库孤儿 project_directory 行清理 —— SQL 与判定(纯逻辑,可单测)
// [feat: db-orphan-prune] 2026-08-12
//
// ## 为什么需要这个
//
// 上游迁移 `20260612174303_project_dir_strategy` 重建 `project_directory` 表时,新表带
//   CONSTRAINT fk_project_directory_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES project(id)
// 并试图用 `PRAGMA foreign_keys=OFF` 绕过检查。**但该 pragma 在事务内是 no-op**(SQLite 明文规定),
// 而 fork/上游的迁移执行器 `packages/core/src/database/migration.ts` 恰恰是
//   db.transaction((tx) => migration.up(tx))
// 每条迁移各跑在自己的事务里 → 外键始终是开的。
//
// 于是 `INSERT INTO __new_project_directory ... SELECT ... FROM project_directory` 只要遇到
// **孤儿行**(project_id 指向已不存在的 project)就报 `FOREIGN KEY constraint failed`,
// 迁移失败 → sidecar 退出(code 1)→ 前端等不到 server → 应用停在「启动本地服务器时发生错误」错误页。
// **后果是整个应用打不开,不是某个功能退化。**
//
// 2026-08-12 Mac 端真机实证:8月8 的存量 local 库有 8 条孤儿行 → 必崩;空库启动则一切正常。
// 对照实验(同一份数据副本)确认根因:
//   事务外 PRAGMA foreign_keys=ON  → FOREIGN KEY constraint failed(正是 INSERT 那行)
//   sqlite3 CLI 默认(OFF)          → 成功
//
// ## 为什么不直接改那条迁移
//
// `packages/core/` 在 pre-commit 黑名单内,改它要走 R4 override(复核报告 + user 二次确认 + 季度配额)。
// 而 R4 要求先论证「wrapper 替代不可行」—— 这里 wrapper **可行**:主进程在 spawn sidecar 之前
// 把孤儿行清掉,迁移自然通过。故走 R1 第 1 级(全部在 fork 新文件内完成),零 override、零改上游。
//
// ## 安全性
//
// 删除的是 project_id 指向不存在 project 的行 —— 这些行本就无法被任何 project 引用到,是垃圾数据;
// 上游新表的外键约束也正是在拒绝它们。清理只是提前做了迁移本该做却做不到的事。

/** 上游那条会因孤儿行而失败的迁移 id */
export const TARGET_MIGRATION_ID = "20260612174303_project_dir_strategy"

/** 迁移记录表(注:表名是 `migration`,不是 `__migration`) */
export const MIGRATION_TABLE = "migration"

export const SQL = {
  /** 表是否存在 */
  tableExists: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
  /** 该迁移是否已完成 */
  migrationDone: `SELECT id FROM \`migration\` WHERE id=?`,
  /** 孤儿行计数 */
  countOrphans: `SELECT COUNT(*) AS c FROM \`project_directory\` pd
                 LEFT JOIN \`project\` p ON p.id = pd.project_id
                 WHERE p.id IS NULL`,
  /** 删除孤儿行 */
  deleteOrphans: `DELETE FROM \`project_directory\`
                  WHERE project_id NOT IN (SELECT id FROM \`project\`)`,
} as const

export type PruneDecision =
  | { act: false; reason: "db-missing" | "already-migrated" | "no-table" | "no-orphans" }
  | { act: true; orphans: number }

/**
 * 判定要不要动手。抽成纯函数以便单测,也把「什么都不做」的分支写清楚:
 * - 库文件不存在(全新安装)→ 无需清理
 * - 目标迁移已完成 → 说明这库要么本来就没孤儿、要么早就迁过了,不再扫
 * - project_directory / project 表不存在(库太老或太新)→ 不动
 * - 没有孤儿行 → 不动(绝大多数用户走这条,零写入)
 */
export function decidePrune(input: {
  dbExists: boolean
  migrationDone: boolean
  hasProjectDirectoryTable: boolean
  hasProjectTable: boolean
  orphanCount: number
}): PruneDecision {
  if (!input.dbExists) return { act: false, reason: "db-missing" }
  if (input.migrationDone) return { act: false, reason: "already-migrated" }
  if (!input.hasProjectDirectoryTable || !input.hasProjectTable) return { act: false, reason: "no-table" }
  if (input.orphanCount <= 0) return { act: false, reason: "no-orphans" }
  return { act: true, orphans: input.orphanCount }
}

/**
 * 由渠道推导 sidecar 实际使用的库文件名。
 * 规则对齐 server.ts createSidecarEnv():
 *  - 发布渠道(prod/dev/beta)统一 OPENCODE_DISABLE_CHANNEL_DB=1 → `opencode.db`
 *  - local / 未打包 → OPENCODE_CHANNEL=local → `opencode-local.db`
 */
export function resolveDbFileName(input: { channel: string; packaged: boolean }): string {
  const useChannelDb = !input.packaged || input.channel === "local"
  return useChannelDb ? `opencode-${input.channel === "local" || !input.packaged ? "local" : input.channel}.db` : "opencode.db"
}
