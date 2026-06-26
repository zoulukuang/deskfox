// FORK: REQ-068 — probePath 真实 fs 探测单测(平台无关,Windows CI 可跑)[feat: stale-path-hardening]
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { probePath, probeWithStat } from "./fs-probe"

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

  test("A1 stat 瞬时成功 → ok", async () => {
    expect(await probeWithStat("/x", ok)).toEqual({ ok: true })
  })

  test("A2 stat throw ENOENT → missing", async () => {
    expect(await probeWithStat("/x", throws("ENOENT"))).toEqual({ ok: false, reason: "missing", code: "ENOENT" })
  })

  test("A2b stat throw ENOTDIR → missing", async () => {
    expect(await probeWithStat("/x", throws("ENOTDIR"))).toEqual({ ok: false, reason: "missing", code: "ENOTDIR" })
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
