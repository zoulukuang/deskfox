// [fork-only] REQ-074 isDesktopApp 单测 — 换基座回归防复发:桌面能力检测必须认 window.deskfox
// 桥(Electron preload 注入),不能再认 Tauri 时代的 __TAURI_INTERNALS__。
//   [feat: batch-port-edit-mdlink] 2026-07-07
import { afterEach, describe, expect, test } from "bun:test"
import { isDesktopApp } from "./native"

afterEach(() => {
  delete (window as any).deskfox
  delete (window as any).__TAURI_INTERNALS__
})

describe("isDesktopApp(REQ-074)", () => {
  test("window.deskfox 桥已注入 → true(桌面壳内)", () => {
    ;(window as any).deskfox = { invoke: async () => undefined, listen: async () => () => {} }
    expect(isDesktopApp()).toBe(true)
  })

  test("桥未注入(纯浏览器 / preload 未加载)→ false", () => {
    expect(isDesktopApp()).toBe(false)
  })

  test("只有 Tauri 时代的 __TAURI_INTERNALS__ → false(该字段已不作数)", () => {
    ;(window as any).__TAURI_INTERNALS__ = {}
    expect(isDesktopApp()).toBe(false)
  })
})
