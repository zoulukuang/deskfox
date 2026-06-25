// FORK: REQ-068 — probePath 真实 fs 探测单测(平台无关,Windows CI 可跑)[feat: stale-path-hardening]
import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { probePath } from "./fs-probe"

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
