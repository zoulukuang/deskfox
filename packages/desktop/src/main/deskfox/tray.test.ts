// [fork-only] REQ-099 托盘状态切换单测 [feat: tray-health-status] 2026-08-07
//
// T1 是 bug-repro:修前 setTrayStatus 写完 statusItem.label 就 setContextMenu(buildMenu()),
// 而 buildMenu() 从模板重建、label 写死"状态:就绪"并重新给 statusItem 赋值 → 文案当场被覆盖,
// 菜单永远显示"就绪"。修后 buildMenu() 读模块级 currentStatusLabel。
import { describe, expect, test, mock, beforeEach } from "bun:test"

// electron 由 bunfig.toml [test].preload 的全局 mock 接管(见 ../../../test/electron-mock.ts)。
// 这里只 mock ../store —— 切断 prevent-sleep → store → electron-store 的加载链。
// ⚠️ 不要 mock.module("./prevent-sleep"):bun 的 mock.module 按解析路径全局替换,
//    会把 prevent-sleep.test.ts 依赖的真实导出也换掉(同进程跑全量时那组测试整片红)。
mock.module("../store", () => ({ getStore: () => ({ get: () => undefined, set: () => {} }) }))

const { createTray, setTrayStatus, __resetTrayStateForTest } = await import("./tray")
const { TRAY_STATUS_READY } = await import("./tray-status")

type FakeMenu = { getMenuItemById: (id: string) => { label?: string } | null }
type FakeTray = { menu: FakeMenu; image: { __buffer: Buffer } }

const statusLabelOf = (tray: FakeTray) => tray.menu.getMenuItemById("status")?.label

beforeEach(() => {
  __resetTrayStateForTest()
})

describe("setTrayStatus", () => {
  test("T1(bug-repro):连续两次切状态,菜单文案 = 最后一次的值(修前恒为「状态:就绪」)", () => {
    const tray = createTray() as unknown as FakeTray
    expect(statusLabelOf(tray)).toBe(TRAY_STATUS_READY.label)

    setTrayStatus("restarting")
    expect(statusLabelOf(tray)).toContain("重启中")

    setTrayStatus("gave-up")
    const final = statusLabelOf(tray)
    expect(final).toContain("已停止")
    expect(final).not.toBe(TRAY_STATUS_READY.label)
  })

  test("状态切换同时换图标(三态图标字节互不相同)", () => {
    const tray = createTray() as unknown as FakeTray
    const ok = tray.image.__buffer.toString("base64")

    setTrayStatus("restarting")
    const restarting = tray.image.__buffer.toString("base64")

    setTrayStatus("gave-up")
    const gaveUp = tray.image.__buffer.toString("base64")

    expect(new Set([ok, restarting, gaveUp]).size).toBe(3)
  })

  test("恢复 ready → 文案与图标都回到就绪态", () => {
    const tray = createTray() as unknown as FakeTray
    const okIcon = tray.image.__buffer.toString("base64")

    setTrayStatus("restarting")
    expect(statusLabelOf(tray)).not.toBe(TRAY_STATUS_READY.label)

    setTrayStatus("ready")
    expect(statusLabelOf(tray)).toBe(TRAY_STATUS_READY.label)
    expect(tray.image.__buffer.toString("base64")).toBe(okIcon)
  })

  test("memory-pressure / 未知状态 → 托盘不变(不误报「服务已停止」)", () => {
    const tray = createTray() as unknown as FakeTray
    setTrayStatus("restarting")
    const label = statusLabelOf(tray)
    const icon = tray.image.__buffer.toString("base64")

    setTrayStatus("memory-pressure")
    setTrayStatus("totally-unknown")

    expect(statusLabelOf(tray)).toBe(label)
    expect(tray.image.__buffer.toString("base64")).toBe(icon)
  })

  test("createTray 之前调用不抛(启动竞速:看门狗可能先于托盘就绪)", () => {
    expect(() => setTrayStatus("restarting")).not.toThrow()
    // 之后创建的托盘应带上已记录的状态,而不是回落"就绪"
    const tray = createTray() as unknown as FakeTray
    expect(statusLabelOf(tray)).toContain("重启中")
  })
})
