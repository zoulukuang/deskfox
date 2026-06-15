// [fork-only] npm 国内镜像决策单测 — 从 Tauri npm_registry.rs #[cfg(test)] 平移
//   [feat: npm-registry-cn-mirror / electron-replatform] 2026-06-13
import { describe, expect, test } from "bun:test"
import { pickRegistry, isFresh } from "./npm-registry"

const NPMMIRROR = "https://registry.npmmirror.com"
const HUAWEI = "https://mirrors.huaweicloud.com/repository/npm"
const TENCENT = "https://mirrors.cloud.tencent.com/npm"
const CACHE_TTL_SECS = 14 * 24 * 60 * 60

describe("pickRegistry", () => {
  test("npmjs 快 → 用官方(null)", () => {
    expect(pickRegistry(500, [[100, NPMMIRROR]])).toBeNull()
  })
  test("npmjs 慢 → 取最快镜像", () => {
    expect(
      pickRegistry(9000, [
        [300, HUAWEI],
        [80, NPMMIRROR],
        [500, TENCENT],
      ]),
    ).toBe(NPMMIRROR)
  })
  test("npmjs 不可达 → 用镜像", () => {
    expect(pickRegistry(null, [[420, TENCENT]])).toBe(TENCENT)
  })
  test("无可用镜像 → 回落官方(null)", () => {
    expect(pickRegistry(null, [])).toBeNull()
    expect(pickRegistry(9000, [])).toBeNull()
  })
})

describe("isFresh", () => {
  test("TTL 边界", () => {
    expect(isFresh(1000, 1000 + CACHE_TTL_SECS - 1)).toBe(true)
    expect(isFresh(1000, 1000 + CACHE_TTL_SECS)).toBe(false)
  })
  test("时钟回拨 → 视为新鲜不误判", () => {
    expect(isFresh(1000, 500)).toBe(true)
  })
})
