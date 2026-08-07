// [fork-only] REQ-099 托盘健康状态映射单测 [feat: tray-health-status] 2026-08-07
import { describe, expect, test } from "bun:test"
import { mapWatchdogStatusToTray, TRAY_STATUS_READY } from "./tray-status"

describe("mapWatchdogStatusToTray", () => {
  // T2:看门狗 3 态各有对应视图,且互不相同
  test("ready → 就绪(ok 图标)", () => {
    expect(mapWatchdogStatusToTray("ready")).toEqual(TRAY_STATUS_READY)
  })

  test("restarting → 重启中(restarting 图标)", () => {
    const view = mapWatchdogStatusToTray("restarting")
    expect(view?.icon).toBe("restarting")
    expect(view?.label).toContain("重启中")
  })

  test("gave-up → 已停止(gave-up 图标)", () => {
    const view = mapWatchdogStatusToTray("gave-up")
    expect(view?.icon).toBe("gave-up")
    expect(view?.label).toContain("已停止")
  })

  test("三态的文案与图标两两互不相同(否则用户分辨不出)", () => {
    const views = ["ready", "restarting", "gave-up"].map((s) => mapWatchdogStatusToTray(s)!)
    expect(new Set(views.map((v) => v.label)).size).toBe(3)
    expect(new Set(views.map((v) => v.icon)).size).toBe(3)
  })

  // T3:非看门狗状态 / 未知值 → 不改托盘,且不抛
  test("memory-pressure(memory-brake 另一条线,同通道)→ undefined 不改托盘", () => {
    expect(mapWatchdogStatusToTray("memory-pressure")).toBeUndefined()
  })

  test("未知字符串 / 非字符串 → undefined,不抛异常", () => {
    expect(mapWatchdogStatusToTray("whatever")).toBeUndefined()
    expect(mapWatchdogStatusToTray(undefined)).toBeUndefined()
    expect(mapWatchdogStatusToTray(null)).toBeUndefined()
    expect(mapWatchdogStatusToTray(42)).toBeUndefined()
    expect(mapWatchdogStatusToTray({ status: "ready" })).toBeUndefined()
  })

  test("原型链上的 key 不被误当状态(toString / constructor)", () => {
    expect(mapWatchdogStatusToTray("toString")).toBeUndefined()
    expect(mapWatchdogStatusToTray("constructor")).toBeUndefined()
  })
})
