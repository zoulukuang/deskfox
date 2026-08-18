// [fork-only] REQ-084① 启动期检查单测 [feat: voice-preclear-batch] 2026-08-18
// 对应 1-spec §3-S1 R8 用例 T5 的 unit 部分(真机部分在 commit 3 的验收脚本)。
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { checkAndQuarantineAheadDb, listQuarantinedDbs } from "./db-schema-startup-check"
import { MIGRATION_BASELINE } from "./migration-baseline.generated"
import type { ReadonlyDb } from "./db-schema-guard-io"

function tmpDir(tag: string): string {
  const dir = path.join(os.tmpdir(), `deskfox-startup-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// ⚠ Windows:未 finalize 的 statement 会让 sqlite3_close 返回 BUSY,而 bun 的 close() 把它静默吞掉 →
//   文件句柄不释放 → 本模块要断言的 renameSync 直接 EBUSY(POSIX 允许改名已打开的文件,Windows 不允许)。
//   所以此处 statement 必须逐条 finalize,且用 close(true) —— 真有残留就抛出来,不留假绿。
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

function makeDb(dir: string, ids: string[], name = "opencode.db"): string {
  const p = path.join(dir, name)
  const db = new Database(p, { create: true })
  db.exec("CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL)")
  const s = db.prepare("INSERT INTO migration (id, time_completed) VALUES (?, ?)")
  for (const id of ids) s.run(id, 1)
  s.finalize()
  db.close(true)
  return p
}

describe("checkAndQuarantineAheadDb", () => {
  test("超前库 → 隔离挪走,原路径消失、.incompatible-* 出现且内容保留", () => {
    const dir = tmpDir("ahead")
    const p = makeDb(dir, [...MIGRATION_BASELINE.slice(0, 3), "99991231235959_pollution_probe"])
    writeFileSync(`${p}-wal`, "wal-bytes")

    const r = checkAndQuarantineAheadDb(p, bunOpener)

    expect(r.quarantined).toBe(true)
    expect(r.reason).toBe("quarantined")
    expect(r.dbName).toBe("opencode.db")
    expect(r.dir).toBe(dir)
    expect(existsSync(p)).toBe(false) // 原库已挪开,core 会以空库重起
    expect(existsSync(`${p}-wal`)).toBe(false) // wal 必须跟着走,否则成孤儿
    expect(existsSync(`${p}-shm`)).toBe(false) // shm 同理(sqlite 打开时会自建)
    const left = listQuarantinedDbs(dir)
    // db 本体 + -wal + -shm 三件套全部改名保留
    expect(left.length).toBe(3)
    expect(left.every((n) => n.includes(".incompatible-"))).toBe(true)
    expect(left.some((n) => n.startsWith("opencode.db.incompatible-"))).toBe(true)
  })

  test("正常库 → 不动它(回归:绝不能误伤正常用户)", () => {
    const dir = tmpDir("ok")
    const p = makeDb(dir, MIGRATION_BASELINE.slice(0, 5))
    const r = checkAndQuarantineAheadDb(p, bunOpener)
    expect(r.quarantined).toBe(false)
    expect(r.reason).toBe("ok")
    expect(existsSync(p)).toBe(true)
    expect(listQuarantinedDbs(dir)).toEqual([])
  })

  test("老库(仅 legacy 名)→ 不动它", () => {
    const dir = tmpDir("legacy")
    const p = path.join(dir, "opencode.db")
    const db = new Database(p, { create: true })
    db.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, name TEXT)")
    const legacy = db.prepare("INSERT INTO __drizzle_migrations (name) VALUES (?)")
    legacy.run("0000_legacy")
    legacy.finalize()
    db.close(true)
    const r = checkAndQuarantineAheadDb(p, bunOpener)
    expect(r.quarantined).toBe(false)
    expect(existsSync(p)).toBe(true)
  })

  test("库不存在 → no-db,不建库不报错", () => {
    const dir = tmpDir("nodb")
    const p = path.join(dir, "opencode.db")
    const r = checkAndQuarantineAheadDb(p, bunOpener)
    expect(r.reason).toBe("no-db")
    expect(existsSync(p)).toBe(false)
  })

  test("损坏库 → unknown 走 fail-open,不隔离(读不出不等于超前)", () => {
    const dir = tmpDir("corrupt")
    const p = path.join(dir, "opencode.db")
    writeFileSync(p, "not-a-sqlite-file")
    const r = checkAndQuarantineAheadDb(p, bunOpener)
    expect(r.quarantined).toBe(false)
    expect(r.reason).toBe("ok")
    expect(existsSync(p)).toBe(true) // 好库/坏库都不该被本检测挪走
  })

  test("opener 抛错 → 不冒泡,放行启动", () => {
    const dir = tmpDir("boom")
    const p = makeDb(dir, ["99991231235959_probe"])
    const boom = () => {
      throw new Error("boom")
    }
    expect(() => checkAndQuarantineAheadDb(p, boom)).not.toThrow()
    expect(existsSync(p)).toBe(true) // 读不出 → unknown → 不隔离
  })

  test("幂等:隔离后再跑一次 → no-db(库已不在),不重复处置", () => {
    const dir = tmpDir("idem")
    const p = makeDb(dir, ["99991231235959_probe"])
    expect(checkAndQuarantineAheadDb(p, bunOpener).quarantined).toBe(true)
    const second = checkAndQuarantineAheadDb(p, bunOpener)
    expect(second.quarantined).toBe(false)
    expect(second.reason).toBe("no-db")
  })
})

describe("listQuarantinedDbs", () => {
  test("目录不存在 → 空数组不抛", () => {
    expect(listQuarantinedDbs("/definitely/not/here")).toEqual([])
  })
  test("只列 .incompatible-*,不误报正常文件", () => {
    const dir = tmpDir("list")
    writeFileSync(path.join(dir, "opencode.db"), "x")
    writeFileSync(path.join(dir, "opencode.db.incompatible-20260818120000"), "y")
    expect(listQuarantinedDbs(dir)).toEqual(["opencode.db.incompatible-20260818120000"])
  })
})
