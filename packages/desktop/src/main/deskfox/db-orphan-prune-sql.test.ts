// [fork-only] 孤儿行清理回归钉 [feat: db-orphan-prune] 2026-08-12
//
// [bug-repro: 存量库里有孤儿 project_directory 行时,上游迁移 20260612174303_project_dir_strategy
//   的 INSERT...SELECT 撞 FOREIGN KEY constraint failed → 迁移失败 → sidecar exit 1 →
//   应用停在「启动本地服务器时发生错误」错误页,整个应用打不开。
//   2026-08-12 Mac 端真机实证:8月8 存量 local 库 8 条孤儿 → 必崩;空库正常。]
//
// 本测试用 bun:sqlite 建真库,**真实重放那条上游迁移**:
//   T1 证明 bug 存在(有孤儿 + 外键开 → 迁移抛 FOREIGN KEY constraint failed)
//   T2 证明修复有效(先跑清理再迁移 → 通过,且合法数据一行不少)
//   T3 证明 PRAGMA foreign_keys=OFF 在事务内确实是 no-op(根因本身)
import { test, expect, describe } from "bun:test"
import { Database } from "bun:sqlite"
import { SQL, decidePrune, resolveDbFileName, TARGET_MIGRATION_ID } from "./db-orphan-prune-sql"

/** 建一个迁移前状态的库:project / project_directory,含 N 条孤儿行 */
function makeLegacyDb(orphans: number) {
  const db = new Database(":memory:")
  db.exec(`CREATE TABLE \`project\` (id TEXT PRIMARY KEY, name TEXT)`)
  db.exec(`
    CREATE TABLE \`project_directory\` (
      \`project_id\` text NOT NULL,
      \`directory\` text NOT NULL,
      \`type\` text NOT NULL,
      \`time_created\` integer NOT NULL,
      CONSTRAINT \`project_directory_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
      CONSTRAINT \`fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
    )`)
  db.exec(`CREATE TABLE \`migration\` (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)`)
  // 2 个合法 project + 各 1 条目录
  for (const id of ["p1", "p2"]) {
    db.run(`INSERT INTO \`project\` (id, name) VALUES (?, ?)`, [id, "n-" + id])
    db.run(`INSERT INTO \`project_directory\` VALUES (?, ?, ?, ?)`, [id, "/d/" + id, "primary", 1])
  }
  // N 条孤儿(project_id 指向不存在的 project)
  for (let i = 0; i < orphans; i++) {
    db.run(`INSERT INTO \`project_directory\` VALUES (?, ?, ?, ?)`, ["gone" + i, "/orphan/" + i, "primary", 1])
  }
  return db
}

/** 原样重放上游迁移 20260612174303_project_dir_strategy 的 up() */
function runUpstreamMigration(db: Database) {
  db.exec("BEGIN")
  try {
    db.exec("ALTER TABLE `project_directory` ADD `strategy` text")
    db.exec("PRAGMA foreign_keys=OFF") // 上游原样:事务内 → no-op
    db.exec(`
      CREATE TABLE \`__new_project_directory\` (
        \`project_id\` text NOT NULL,
        \`directory\` text NOT NULL,
        \`type\` text,
        \`strategy\` text,
        \`time_created\` integer NOT NULL,
        CONSTRAINT \`project_directory_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
        CONSTRAINT \`fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
      )`)
    db.exec(
      "INSERT INTO `__new_project_directory`(`project_id`, `directory`, `type`, `time_created`) " +
        "SELECT `project_id`, `directory`, `type`, `time_created` FROM `project_directory`",
    )
    db.exec("DROP TABLE `project_directory`")
    db.exec("ALTER TABLE `__new_project_directory` RENAME TO `project_directory`")
    db.exec("COMMIT")
  } catch (e) {
    db.exec("ROLLBACK")
    throw e
  }
}

describe("db-orphan-prune (bug 复现与修复)", () => {
  test("T1 有孤儿行时,上游迁移必然失败 —— 这就是应用打不开的原因", () => {
    const db = makeLegacyDb(3)
    db.exec("PRAGMA foreign_keys=ON") // 模拟应用运行时
    expect(() => runUpstreamMigration(db)).toThrow(/FOREIGN KEY constraint failed/i)
    db.close()
  })

  test("T2 先跑清理再迁移 → 通过,且合法数据一行不少", () => {
    const db = makeLegacyDb(3)
    db.exec("PRAGMA foreign_keys=ON")

    const before = db.query(SQL.countOrphans).get() as { c: number }
    expect(before.c).toBe(3)

    db.run(SQL.deleteOrphans) // 修复动作

    const after = db.query(SQL.countOrphans).get() as { c: number }
    expect(after.c).toBe(0)

    expect(() => runUpstreamMigration(db)).not.toThrow()

    // 合法数据完好:p1 / p2 各自的目录仍在
    const rows = db.query("SELECT project_id FROM `project_directory` ORDER BY project_id").all() as {
      project_id: string
    }[]
    expect(rows.map((r) => r.project_id)).toEqual(["p1", "p2"])
    db.close()
  })

  test("T3 根因钉子 —— PRAGMA foreign_keys=OFF 在事务内是 no-op(SQLite 既定行为)", () => {
    const db = makeLegacyDb(1)
    db.exec("PRAGMA foreign_keys=ON")
    db.exec("BEGIN")
    db.exec("PRAGMA foreign_keys=OFF") // 事务内,不生效
    const v = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }
    expect(v.foreign_keys).toBe(1) // 仍然是开的 —— 上游那条迁移的错误假设就在这
    db.exec("ROLLBACK")
    db.close()
  })

  test("T4 无孤儿的库:清理是 no-op,迁移本来就能过", () => {
    const db = makeLegacyDb(0)
    db.exec("PRAGMA foreign_keys=ON")
    expect((db.query(SQL.countOrphans).get() as { c: number }).c).toBe(0)
    expect(() => runUpstreamMigration(db)).not.toThrow()
    db.close()
  })
})

describe("decidePrune 判定分支", () => {
  const base = {
    dbExists: true,
    migrationDone: false,
    hasProjectDirectoryTable: true,
    hasProjectTable: true,
    orphanCount: 5,
  }
  test("全新安装(库不存在)→ 不动", () => {
    expect(decidePrune({ ...base, dbExists: false })).toEqual({ act: false, reason: "db-missing" })
  })
  test("目标迁移已完成 → 不再扫", () => {
    expect(decidePrune({ ...base, migrationDone: true })).toEqual({ act: false, reason: "already-migrated" })
  })
  test("表不存在(库太老/太新)→ 不动", () => {
    expect(decidePrune({ ...base, hasProjectDirectoryTable: false })).toEqual({ act: false, reason: "no-table" })
    expect(decidePrune({ ...base, hasProjectTable: false })).toEqual({ act: false, reason: "no-table" })
  })
  test("没有孤儿 → 不动(绝大多数用户走这条,零写入)", () => {
    expect(decidePrune({ ...base, orphanCount: 0 })).toEqual({ act: false, reason: "no-orphans" })
  })
  test("有孤儿 → 动手,并带出条数", () => {
    expect(decidePrune(base)).toEqual({ act: true, orphans: 5 })
  })
})

describe("库文件名推导(对齐 server.ts createSidecarEnv)", () => {
  test("发布渠道统一 opencode.db", () => {
    expect(resolveDbFileName({ channel: "prod", packaged: true })).toBe("opencode.db")
    expect(resolveDbFileName({ channel: "dev", packaged: true })).toBe("opencode.db")
    expect(resolveDbFileName({ channel: "beta", packaged: true })).toBe("opencode.db")
  })
  test("local 档与未打包 → opencode-local.db", () => {
    expect(resolveDbFileName({ channel: "local", packaged: true })).toBe("opencode-local.db")
    expect(resolveDbFileName({ channel: "prod", packaged: false })).toBe("opencode-local.db")
  })
})

test("目标迁移 id 与上游文件名一致(上游改名即红)", () => {
  expect(TARGET_MIGRATION_ID).toBe("20260612174303_project_dir_strategy")
})
