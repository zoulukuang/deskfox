// [feat: startup-sidebar-ready-gate] 2026-05-29 — sidebar 启动期 ready gate 纯逻辑测试
import { describe, expect, test } from "bun:test"
import { shouldGateProjectTile, shouldSkipProjectNavigate } from "./ready-gate"

describe("shouldGateProjectTile", () => {
  test("bootReady=true → 永远 false(正常态不 gate)", () => {
    expect(shouldGateProjectTile(true, false)).toBe(false)
    expect(shouldGateProjectTile(true, true)).toBe(false)
  })

  test("bootReady=false + 已选 tile → false(toggle sidebar 不需要 gate)", () => {
    expect(shouldGateProjectTile(false, true)).toBe(false)
  })

  test("bootReady=false + 未选 tile → true(切项目 HTTP 会卡,gate 住)", () => {
    expect(shouldGateProjectTile(false, false)).toBe(true)
  })
})

describe("shouldSkipProjectNavigate", () => {
  test("跟 shouldGateProjectTile 同一规则(功能拦截 = 视觉 gate 同源)", () => {
    for (const ready of [true, false]) {
      for (const selected of [true, false]) {
        expect(shouldSkipProjectNavigate(ready, selected)).toBe(shouldGateProjectTile(ready, selected))
      }
    }
  })

  test("启动期点未选 tile → 跳过 navigate(避免撞 sidecar 未就绪 HTTP)", () => {
    expect(shouldSkipProjectNavigate(false, false)).toBe(true)
  })

  test("启动期点已选 tile → 不跳过(toggle sidebar 是纯前端)", () => {
    expect(shouldSkipProjectNavigate(false, true)).toBe(false)
  })

  test("就绪后点任一 tile → 不跳过(正常态)", () => {
    expect(shouldSkipProjectNavigate(true, false)).toBe(false)
    expect(shouldSkipProjectNavigate(true, true)).toBe(false)
  })
})
