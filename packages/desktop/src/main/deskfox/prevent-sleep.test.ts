// [fork-only] prevent-sleep enabledFromStoreValue 单测 — 从 Tauri prevent_sleep.rs #[cfg(test)] 平移。
// 防回归:防休眠启动恢复读 store value 解析开关(Electron 首版无持久化/恢复 → 修复 #4)。
//   [feat: electron-replatform-macos] 2026-06-14
import { describe, expect, test, mock } from "bun:test"

// electron 由 bunfig.toml [test].preload 的全局 mock 接管(见 ../../../test/electron-mock.ts)。
// 这里仅 mock ../store —— 切断 store→electron-store 加载链,让 enabledFromStoreValue 纯函数可独立测。
mock.module("../store", () => ({ getStore: () => ({ get: () => undefined, set: () => {} }) }))
const { enabledFromStoreValue } = await import("./prevent-sleep")

describe("enabledFromStoreValue", () => {
  test("存了 true → 开", () => {
    expect(enabledFromStoreValue({ enabled: true })).toBe(true)
  })

  test("存了 false → 关", () => {
    expect(enabledFromStoreValue({ enabled: false })).toBe(false)
  })

  test("从没存过(undefined / null)→ 默认关(不擅自改用户电源行为)", () => {
    expect(enabledFromStoreValue(undefined)).toBe(false)
    expect(enabledFromStoreValue(null)).toBe(false)
  })

  test("缺 enabled key → 关", () => {
    expect(enabledFromStoreValue({})).toBe(false)
  })

  test("类型错(字符串 / 数字 / 非 bool)→ 关", () => {
    expect(enabledFromStoreValue({ enabled: "yes" })).toBe(false)
    expect(enabledFromStoreValue("totally-wrong")).toBe(false)
    expect(enabledFromStoreValue(1)).toBe(false)
  })
})
