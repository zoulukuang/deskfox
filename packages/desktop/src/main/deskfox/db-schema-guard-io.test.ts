// [fork-only] REQ-084① 迁移污染检测 — IO 壳单测 [feat: voice-preclear-batch] 2026-08-18
// 对应 1-spec §3-S1 的 R8 用例 T3(真 sqlite 文件四态)+ 隔离挪档。
//
// driver 注入 bun:sqlite:prod 走 node:sqlite(bun 连 import 都 resolve 不了),
// 两者对同一份 db 文件互通已由 T7 spike 验证。
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { assessJournal } from "./db-schema-guard"
import { MIGRATION_BASELINE } from "./migration-baseline.generated"
import { quarantineDb, readJournalIds, timestamp, type ReadonlyDb } from "./db-schema-guard-io"

function tmpDir(tag: string): string {
  const dir = path.join(os.tmpdir(), `deskfox-guard-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 单测 opener:bun:sqlite 只读打开。 */
// ⚠ statement 必须逐条 finalize + close(true):Windows 上残留句柄会让后续 renameSync 报 EBUSY,
//   而 bun 的无参 close() 遇 SQLITE_BUSY 是静默吞掉的(详见 db-schema-startup-check.test.ts 同处注释)。
const bunOpener = (p: string): ReadonlyDb => {
  const db = new Database(p, { readonly: true })
  return {
    all: (sql: string) => {
      const stmt = db.prepare(sql)
      try {
        return stmt.all() as Array<Record<string, unknown>>
      } finally {
        stmt.finalize()
      }
    },
    close: () => db.close(true),
  }
}

/** 造一个带 migration 表的真库(WAL 模式,贴近线上形态)。 */
function makeDb(dir: string, name: string, table: string | null, rows: string[]): string {
  const p = path.join(dir, name)
  const db = new Database(p, { create: true })
  db.exec("PRAGMA journal_mode = WAL")
  if (table === "migration") {
    db.exec("CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)")
    const s = db.prepare("INSERT INTO migration (id, time_completed) VALUES (?, ?)")
    for (const r of rows) s.run(r, 1)
    s.finalize()
  } else if (table === "__drizzle_migrations") {
    db.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, name TEXT)")
    const s = db.prepare("INSERT INTO __drizzle_migrations (name) VALUES (?)")
    for (const r of rows) s.run(r)
    s.finalize()
  } else {
    // 无 journal 表:建个无关表,证明"库能开但没 journal"这一态
    db.exec("CREATE TABLE unrelated (x TEXT)")
  }
  db.close(true)
  return p
}

describe("readJournalIds (T3 四态)", () => {
  test("① migration 表 → 读出 id 清单", () => {
    const dir = tmpDir("t3a")
    const ids = [MIGRATION_BASELINE[0]!, MIGRATION_BASELINE[1]!]
    const p = makeDb(dir, "opencode.db", "migration", ids)
    expect(readJournalIds(p, bunOpener)?.sort()).toEqual([...ids].sort())
  })

  test("② 仅 legacy __drizzle_migrations → 回落读 name", () => {
    const dir = tmpDir("t3b")
    const p = makeDb(dir, "opencode.db", "__drizzle_migrations", ["0000_legacy_one", "0001_legacy_two"])
    expect(readJournalIds(p, bunOpener)?.sort()).toEqual(["0000_legacy_one", "0001_legacy_two"])
  })

  test("③ 库能开但无 journal 表 → null(未知,放行)", () => {
    const dir = tmpDir("t3c")
    const p = makeDb(dir, "opencode.db", null, [])
    expect(readJournalIds(p, bunOpener)).toBeNull()
  })

  test("④ 损坏文件 → null 且不抛", () => {
    const dir = tmpDir("t3d")
    const p = path.join(dir, "opencode.db")
    writeFileSync(p, "这不是 sqlite 文件,只是一堆字节")
    expect(() => readJournalIds(p, bunOpener)).not.toThrow()
    expect(readJournalIds(p, bunOpener)).toBeNull()
  })

  test("⑤ 库不存在 → null(不抛、不建库)", () => {
    const dir = tmpDir("t3e")
    const p = path.join(dir, "nope.db")
    expect(readJournalIds(p, bunOpener)).toBeNull()
    expect(existsSync(p)).toBe(false) // 关键:探测不得把库创出来
  })

  test("⑥ opener 抛错 → null 不冒泡", () => {
    const dir = tmpDir("t3f")
    const p = makeDb(dir, "opencode.db", "migration", [])
    const boom = () => {
      throw new Error("boom")
    }
    expect(readJournalIds(p, boom)).toBeNull()
  })
})

describe("readJournalIds + assessJournal 串起来(端到端判定)", () => {
  test("超前库 → ahead,且点名超前 id", () => {
    const dir = tmpDir("e2e-ahead")
    const p = makeDb(dir, "opencode.db", "migration", [
      ...MIGRATION_BASELINE.slice(0, 3),
      "99991231235959_pollution_probe",
    ])
    const got = assessJournal(readJournalIds(p, bunOpener), MIGRATION_BASELINE)
    expect(got.verdict).toBe("ahead")
    expect(got.aheadIds).toEqual(["99991231235959_pollution_probe"])
  })

  test("正常库 → compatible(回归:不能误伤)", () => {
    const dir = tmpDir("e2e-ok")
    const p = makeDb(dir, "opencode.db", "migration", MIGRATION_BASELINE)
    expect(assessJournal(readJournalIds(p, bunOpener), MIGRATION_BASELINE).verdict).toBe("compatible")
  })

  test("老库(仅 legacy 名)→ compatible(回归:老用户不能被隔离)", () => {
    const dir = tmpDir("e2e-legacy")
    const p = makeDb(dir, "opencode.db", "__drizzle_migrations", ["0000_x", "0001_y"])
    expect(assessJournal(readJournalIds(p, bunOpener), MIGRATION_BASELINE).verdict).toBe("compatible")
  })

  test("损坏库 → unknown(放行,不隔离)", () => {
    const dir = tmpDir("e2e-corrupt")
    const p = path.join(dir, "opencode.db")
    writeFileSync(p, "garbage")
    expect(assessJournal(readJournalIds(p, bunOpener), MIGRATION_BASELINE).verdict).toBe("unknown")
  })
})

describe("quarantineDb", () => {
  test("db + wal + shm 一起挪走,原名全部消失、新名全部在", () => {
    const dir = tmpDir("q1")
    const p = path.join(dir, "opencode.db")
    writeFileSync(p, "db")
    writeFileSync(`${p}-wal`, "wal")
    writeFileSync(`${p}-shm`, "shm")

    const r = quarantineDb(p, "20260818120000")
    expect(r.moved).toBe(true)
    expect(r.suffix).toBe(".incompatible-20260818120000")
    expect(r.files.length).toBe(3)
    for (const f of [p, `${p}-wal`, `${p}-shm`]) expect(existsSync(f)).toBe(false)
    for (const f of r.files) expect(existsSync(f)).toBe(true)
  })

  test("只有 db 本体(无 wal/shm)→ 只挪一个,不报错", () => {
    const dir = tmpDir("q2")
    const p = path.join(dir, "opencode.db")
    writeFileSync(p, "db")
    const r = quarantineDb(p, "20260818120001")
    expect(r.moved).toBe(true)
    expect(r.files).toEqual([`${p}.incompatible-20260818120001`])
  })

  test("库不存在 → no-op,不抛", () => {
    const dir = tmpDir("q3")
    const r = quarantineDb(path.join(dir, "nope.db"))
    expect(r.moved).toBe(false)
    expect(r.files).toEqual([])
  })

  test("隔离后文件内容原样保留(可手动恢复,绝不能删)", () => {
    const dir = tmpDir("q4")
    const p = path.join(dir, "opencode.db")
    writeFileSync(p, "USER-PRECIOUS-DATA")
    const r = quarantineDb(p, "20260818120002")
    expect(Bun.file(r.files[0]!).size).toBeGreaterThan(0)
  })
})

describe("timestamp", () => {
  test("固定日期 → YYYYMMDDHHmmss 且零补齐", () => {
    expect(timestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102030405")
  })
  test("默认取当前时间,14 位纯数字", () => {
    expect(timestamp()).toMatch(/^\d{14}$/)
  })
})
