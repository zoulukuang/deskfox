// [fork-only] DeskFox 数据命名空间隔离单测 [feat: deskfox-data-namespace-isolation] 2026-07-12
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import os from "os"
import path from "path"
import { applyDeskfoxDataNamespace, planNamespaceMigration, resolveDeskfoxXdg } from "./data-namespace"

function tmpHome(tag: string): string {
  const home = path.join(os.tmpdir(), `deskfox-ns-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(home, { recursive: true })
  return home
}

/** 预置一个"旧 opencode 命名空间"(data + config)带真数据。 */
function seedOldNamespace(home: string) {
  const data = path.join(home, ".local", "share", "opencode")
  const config = path.join(home, ".config", "opencode")
  mkdirSync(data, { recursive: true })
  mkdirSync(path.join(data, "log"), { recursive: true })
  mkdirSync(path.join(data, "bin"), { recursive: true })
  mkdirSync(config, { recursive: true })
  writeFileSync(path.join(data, "opencode.db"), "SQLITE-FAKE-SESSIONS")
  writeFileSync(path.join(data, "auth.json"), JSON.stringify({ "alibaba-cn": { type: "api", key: "x" } }))
  writeFileSync(path.join(data, "log", "app.log"), "should-not-copy")
  writeFileSync(path.join(data, "bin", "rg"), "should-not-copy")
  writeFileSync(path.join(data, "opencode.db.bak-20260101-000000"), "should-not-copy")
  writeFileSync(path.join(config, "opencode.jsonc"), '{ "model": "x" }')
  return { data, config }
}

describe("resolveDeskfoxXdg (TC-1)", () => {
  test("无 env → deskfox 专属默认根", () => {
    expect(resolveDeskfoxXdg({}, "/h")).toEqual({
      dataHome: path.join("/h", ".local", "share", "deskfox"),
      configHome: path.join("/h", ".config", "deskfox"),
    })
  })
  test("已显式设 XDG → 尊重不覆盖", () => {
    expect(resolveDeskfoxXdg({ XDG_DATA_HOME: "/custom/d", XDG_CONFIG_HOME: "/custom/c" }, "/h")).toEqual({
      dataHome: "/custom/d",
      configHome: "/custom/c",
    })
  })
})

describe("planNamespaceMigration (TC-2)", () => {
  const base = { sameDir: false, markerExists: false, newHasDb: false, oldHasDb: true }
  test("新旧同目录 → skip same-dir", () => {
    expect(planNamespaceMigration({ ...base, sameDir: true }).reason).toBe("same-dir")
  })
  test("已有标记 → skip already-migrated", () => {
    expect(planNamespaceMigration({ ...base, markerExists: true }).migrate).toBe(false)
  })
  test("新目录已有 db → skip 不覆盖", () => {
    expect(planNamespaceMigration({ ...base, newHasDb: true }).reason).toBe("new-namespace-in-use")
  })
  test("旧目录无 db(全新装)→ skip", () => {
    expect(planNamespaceMigration({ ...base, oldHasDb: false }).reason).toBe("fresh-install-no-history")
  })
  test("旧有 db、新空、无标记 → migrate", () => {
    expect(planNamespaceMigration(base)).toEqual({ migrate: true, reason: "migrate-from-opencode" })
  })
})

describe("applyDeskfoxDataNamespace (TC-3/4/5)", () => {
  test("首启迁移:copy 存量、切 env、排除 log/bin/bak、原目录保留、写标记", async () => {
    const home = tmpHome("migrate")
    const old = seedOldNamespace(home)
    const env: NodeJS.ProcessEnv = {}

    const r = await applyDeskfoxDataNamespace(env, home)

    expect(r.switched).toBe(true)
    expect(r.reason).toBe("migrate-from-opencode")
    // env 设为 deskfox 专属根(TC-3)
    expect(env.XDG_DATA_HOME).toBe(path.join(home, ".local", "share", "deskfox"))
    expect(env.XDG_CONFIG_HOME).toBe(path.join(home, ".config", "deskfox"))
    const newData = path.join(home, ".local", "share", "deskfox", "opencode")
    const newConfig = path.join(home, ".config", "deskfox", "opencode")
    // 关键数据迁到位
    expect(readFileSync(path.join(newData, "opencode.db"), "utf8")).toBe("SQLITE-FAKE-SESSIONS")
    expect(existsSync(path.join(newData, "auth.json"))).toBe(true)
    expect(existsSync(path.join(newConfig, "opencode.jsonc"))).toBe(true)
    // 排除项没被 copy
    expect(existsSync(path.join(newData, "log"))).toBe(false)
    expect(existsSync(path.join(newData, "bin"))).toBe(false)
    expect(existsSync(path.join(newData, "opencode.db.bak-20260101-000000"))).toBe(false)
    // 非破坏:原 opencode 目录保留
    expect(existsSync(path.join(old.data, "opencode.db"))).toBe(true)
    // 幂等标记
    expect(existsSync(path.join(newData, ".deskfox-namespace-migrated"))).toBe(true)
  })

  test("幂等:再次调用不重复迁移(标记生效)(TC-5)", async () => {
    const home = tmpHome("idem")
    seedOldNamespace(home)
    await applyDeskfoxDataNamespace({}, home)
    const newDb = path.join(home, ".local", "share", "deskfox", "opencode", "opencode.db")
    writeFileSync(newDb, "USER-MODIFIED-AFTER-MIGRATE") // 模拟迁移后用户又用了

    const env2: NodeJS.ProcessEnv = {}
    const r2 = await applyDeskfoxDataNamespace(env2, home)

    expect(r2.switched).toBe(true)
    expect(r2.reason).toBe("already-migrated")
    expect(env2.XDG_DATA_HOME).toBe(path.join(home, ".local", "share", "deskfox"))
    // 没被重迁覆盖
    expect(readFileSync(newDb, "utf8")).toBe("USER-MODIFIED-AFTER-MIGRATE")
  })

  test("全新装(无旧数据):直接切 deskfox ns,不迁移", async () => {
    const home = tmpHome("fresh")
    const env: NodeJS.ProcessEnv = {}
    const r = await applyDeskfoxDataNamespace(env, home)
    expect(r.switched).toBe(true)
    expect(r.reason).toBe("fresh-install-no-history")
    expect(env.XDG_DATA_HOME).toBe(path.join(home, ".local", "share", "deskfox"))
  })

  test("用户显式设 XDG(new==old)→ 不隔离(same-dir 保守)", async () => {
    const home = tmpHome("samedir")
    seedOldNamespace(home)
    const custom = path.join(home, ".local", "share") // 使 new==old(deskfox 前缀被覆盖成 share/opencode)
    const env: NodeJS.ProcessEnv = { XDG_DATA_HOME: custom }
    const r = await applyDeskfoxDataNamespace(env, home)
    expect(r.switched).toBe(false)
    expect(r.reason).toBe("same-dir")
  })

  // TC-7 加强 e2e(2026-07-14):贴近真实老用户升级 —— 多 db + wal/shm 边界 + 深层嵌套 完整非破坏迁移。
  // 补现有 TC-4 未覆盖的边界:① opencode.db + opencode-local.db 多 db ② db-wal 迁 / db-shm 排除
  // ③ storage/session|message 多层嵌套内容逐字节完整 ④ 旧目录深层也全保留(非破坏)。
  test("TC-7 加强:真实嵌套结构 + 多 db + wal/shm 边界,完整非破坏迁移", async () => {
    const home = tmpHome("tc7")
    const data = path.join(home, ".local", "share", "opencode")
    const config = path.join(home, ".config", "opencode")
    mkdirSync(path.join(data, "storage", "session", "ses_a", "parts"), { recursive: true })
    mkdirSync(path.join(data, "storage", "message"), { recursive: true })
    mkdirSync(path.join(data, "log"), { recursive: true })
    mkdirSync(path.join(data, "bin"), { recursive: true })
    mkdirSync(config, { recursive: true })
    // 应迁移
    writeFileSync(path.join(data, "opencode.db"), "DB-MAIN-sessions")
    writeFileSync(path.join(data, "opencode-local.db"), "DB-LOCAL-channel") // 多 db
    writeFileSync(path.join(data, "opencode.db-wal"), "WAL-pending-writes") // wal 应迁
    writeFileSync(path.join(data, "auth.json"), '{"anthropic":{"key":"K"}}')
    writeFileSync(path.join(data, "storage", "session", "ses_a", "parts", "p1.json"), "deep-part-content") // 深层嵌套
    writeFileSync(path.join(data, "storage", "message", "msg_1.json"), "msg-content")
    writeFileSync(path.join(config, "opencode.jsonc"), '{"model":"m"}')
    // 应排除
    writeFileSync(path.join(data, "opencode.db-shm"), "SHM-temp") // shm 排除
    writeFileSync(path.join(data, "log", "app.log"), "logs")
    writeFileSync(path.join(data, "bin", "rg"), "binary")
    writeFileSync(path.join(data, "opencode.db.bak-20260101-000000"), "backup")

    const env: NodeJS.ProcessEnv = {}
    const r = await applyDeskfoxDataNamespace(env, home)
    expect(r.switched).toBe(true)
    expect(r.reason).toBe("migrate-from-opencode")

    const newData = path.join(home, ".local", "share", "deskfox", "opencode")
    const newConfig = path.join(home, ".config", "deskfox", "opencode")
    // ① 多 db 都迁 + 内容逐字节一致
    expect(readFileSync(path.join(newData, "opencode.db"), "utf8")).toBe("DB-MAIN-sessions")
    expect(readFileSync(path.join(newData, "opencode-local.db"), "utf8")).toBe("DB-LOCAL-channel")
    // ② wal 迁 / shm 排除
    expect(readFileSync(path.join(newData, "opencode.db-wal"), "utf8")).toBe("WAL-pending-writes")
    expect(existsSync(path.join(newData, "opencode.db-shm"))).toBe(false)
    // ③ 深层嵌套逐字节完整
    expect(readFileSync(path.join(newData, "storage", "session", "ses_a", "parts", "p1.json"), "utf8")).toBe(
      "deep-part-content",
    )
    expect(readFileSync(path.join(newData, "storage", "message", "msg_1.json"), "utf8")).toBe("msg-content")
    expect(readFileSync(path.join(newData, "auth.json"), "utf8")).toBe('{"anthropic":{"key":"K"}}')
    expect(readFileSync(path.join(newConfig, "opencode.jsonc"), "utf8")).toBe('{"model":"m"}')
    // 排除项确实没进新 ns
    expect(existsSync(path.join(newData, "log"))).toBe(false)
    expect(existsSync(path.join(newData, "bin"))).toBe(false)
    expect(existsSync(path.join(newData, "opencode.db.bak-20260101-000000"))).toBe(false)
    // ④ 旧目录深层也全保留(非破坏)
    expect(readFileSync(path.join(data, "opencode.db"), "utf8")).toBe("DB-MAIN-sessions")
    expect(readFileSync(path.join(data, "storage", "session", "ses_a", "parts", "p1.json"), "utf8")).toBe(
      "deep-part-content",
    )
    // 幂等标记
    expect(existsSync(path.join(newData, ".deskfox-namespace-migrated"))).toBe(true)
  })
})
