// FORK: REQ-068 — probePath 真实 fs 探测单测(平台无关,Windows CI 可跑)[feat: stale-path-hardening]
import { describe, expect, test } from "bun:test"
import path, { join } from "node:path"
import { probePath, probeWithStat, type StatFn } from "./fs-probe"

describe("probePath", () => {
  test("存在的目录 → ok", async () => {
    const result = await probePath(import.meta.dir)
    expect(result).toEqual({ ok: true })
  })

  test("不存在的目录 → missing(ENOENT)", async () => {
    const result = await probePath(join(import.meta.dir, "__definitely_not_here_REQ068__"))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("missing")
      expect(result.code).toBe("ENOENT")
    }
  })

  test("路径中间段不是目录(ENOTDIR/ENOENT)→ missing", async () => {
    // 用本测试文件自身当「父目录」,其下再挂子路径 → 父不是目录
    const result = await probePath(join(import.meta.path, "child"))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("missing")
  })
})

// FORK: REQ-068 加固 — 注入假 stat 验超时/errno 分类(离线盘挂起回归)。
// [bug-repro: 离线网络盘 stat 无超时挂起阻塞启动] 2026-06-26 [feat: stale-path-hardening]
describe("probeWithStat 超时/errno 分类", () => {
  const ok: () => Promise<unknown> = () => Promise.resolve({})
  const throws = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }))
  const neverResolves: () => Promise<unknown> = () => new Promise(() => {})
  // 路径感知 stub:按 target 给不同结果("ok" → 成功,其它 → 抛对应 errno),验「根可达性」分支
  const byTarget = (map: Record<string, "ok" | string>): StatFn => (target: string) =>
    map[target] === "ok"
      ? Promise.resolve({})
      : Promise.reject(Object.assign(new Error(String(map[target])), { code: map[target] }))
  // 平台无关取盘符根:Windows "Z:\\proj" → "Z:\\";UNC "\\\\srv\\share\\x" → "\\\\srv\\share\\"
  const winRoot = (p: string) => path.win32.parse(p).root

  test("A1 stat 瞬时成功 → ok", async () => {
    expect(await probeWithStat("/x", ok)).toEqual({ ok: true })
  })

  test("A2 目录被删但盘可达(ENOENT + 盘符根 OK)→ missing(forget)", async () => {
    const stat = byTarget({ "Z:\\proj": "ENOENT", "Z:\\": "ok" })
    expect(await probeWithStat("Z:\\proj", stat, 1000, winRoot)).toEqual({
      ok: false,
      reason: "missing",
      code: "ENOENT",
    })
  })

  test("A2b 中间段不是目录但盘可达(ENOTDIR + 盘符根 OK)→ missing", async () => {
    const stat = byTarget({ "Z:\\file\\child": "ENOTDIR", "Z:\\": "ok" })
    expect(await probeWithStat("Z:\\file\\child", stat, 1000, winRoot)).toEqual({
      ok: false,
      reason: "missing",
      code: "ENOTDIR",
    })
  })

  // [bug-repro: 可移动盘拔出/盘符未映射时 stat 报 ENOENT 被无条件归 missing → forget 永久遗忘合法项目,
  //  用户重连盘后项目从最近列表消失]
  test("A2c 可移动盘拔出/盘符未映射(ENOENT + 盘符根也 ENOENT)→ unreachable(绝不 forget)", async () => {
    const stat = byTarget({ "E:\\proj": "ENOENT", "E:\\": "ENOENT" })
    expect(await probeWithStat("E:\\proj", stat, 1000, winRoot)).toEqual({
      ok: false,
      reason: "unreachable",
      code: "ENOENT",
    })
  })

  test("A2d UNC 服务器离线(ENOENT + 共享根超时)→ unreachable", async () => {
    const stat: StatFn = (target) =>
      target === "\\\\srv\\share\\proj"
        ? Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
        : new Promise(() => {}) // 共享根 stat 挂起 → 竞速超时 → 根不可达
    expect(await probeWithStat("\\\\srv\\share\\proj", stat, 50, winRoot)).toEqual({
      ok: false,
      reason: "unreachable",
      code: "ENOENT",
    })
  })

  test("A3 stat throw EACCES → unreachable(保留 lastProject)", async () => {
    expect(await probeWithStat("/x", throws("EACCES"))).toEqual({
      ok: false,
      reason: "unreachable",
      code: "EACCES",
    })
  })

  test("A4 stat 永不返回(离线盘) → 超时内返回 unreachable,绝不挂起", async () => {
    const start = Date.now()
    const result = await probeWithStat("/offline", neverResolves, 50)
    expect(result).toEqual({ ok: false, reason: "unreachable", code: "ETIMEDOUT" })
    expect(Date.now() - start).toBeLessThan(2000)
  })
})
