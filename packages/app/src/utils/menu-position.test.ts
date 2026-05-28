// [fork-only] menu-position helper 单测 [feat: req-032-menu-clamp-viewport]
// [bug-repro: 选区菜单贴近窗口边沿时按钮溢出视口看不到点不到,四边沿都漏]
import { describe, expect, test } from "bun:test"
import { clampMenuToViewport } from "./menu-position"

const VW = 1200
const VH = 800

describe("clampMenuToViewport", () => {
  test("菜单完全在视口内 → 原位不动", () => {
    const r = clampMenuToViewport({ x: 100, y: 100, width: 220, height: 300, viewportWidth: VW, viewportHeight: VH })
    expect(r).toEqual({ left: 100, top: 100 })
  })

  test("下边沿溢出 → flip 到锚点上方", () => {
    // 用户主报场景:md 文件结尾右键,菜单向下溢出
    const r = clampMenuToViewport({ x: 500, y: 700, width: 220, height: 300, viewportWidth: VW, viewportHeight: VH })
    // y=700, height=300 → bottom=1000 > vh-8=792 → flip 到 y-height=400
    expect(r.top).toBe(400)
    expect(r.left).toBe(500)
  })

  test("下溢出 + flip 后仍顶到上边沿 → clamp 到 margin", () => {
    // 锚点很低(y=750)且菜单很高(height=780) → flip 到 -30 仍破上 → clamp margin=8
    const r = clampMenuToViewport({ x: 100, y: 750, width: 220, height: 780, viewportWidth: VW, viewportHeight: VH })
    expect(r.top).toBe(8)
  })

  test("右边沿溢出(input 卡 360 宽贴右)→ 向左收", () => {
    // x=1000, width=360 → right=1360 > vw-8=1192 → left = 1200-360-8 = 832
    const r = clampMenuToViewport({ x: 1000, y: 100, width: 360, height: 200, viewportWidth: VW, viewportHeight: VH })
    expect(r.left).toBe(832)
    expect(r.top).toBe(100)
  })

  test("左边沿(锚点 x=0 或负)→ clamp 到 margin", () => {
    const r = clampMenuToViewport({ x: 0, y: 100, width: 220, height: 200, viewportWidth: VW, viewportHeight: VH })
    expect(r.left).toBe(8)
  })

  test("上边沿(锚点 y < margin)→ clamp 到 margin,不动 left", () => {
    const r = clampMenuToViewport({ x: 500, y: 2, width: 220, height: 200, viewportWidth: VW, viewportHeight: VH })
    expect(r.top).toBe(8)
    expect(r.left).toBe(500)
  })

  test("右下角同时溢出 → 同时 clamp 水平 + flip 垂直", () => {
    // 用户实报场景的变体:右下角选区
    const r = clampMenuToViewport({ x: 1100, y: 750, width: 360, height: 300, viewportWidth: VW, viewportHeight: VH })
    expect(r.left).toBe(832) // 水平向左收
    expect(r.top).toBe(450) // 垂直 flip:750-300
  })

  test("自定义 margin 生效", () => {
    const r = clampMenuToViewport({ x: 1180, y: 100, width: 220, height: 200, viewportWidth: VW, viewportHeight: VH, margin: 20 })
    // right=1400 > vw-20=1180 → left = 1200-220-20 = 960
    expect(r.left).toBe(960)
  })

  test("菜单大于视口(极端)→ 至少保证 left/top ≥ margin", () => {
    const r = clampMenuToViewport({ x: 100, y: 100, width: 2000, height: 1500, viewportWidth: VW, viewportHeight: VH })
    // width > vw → vw-width-margin 是负数,会被下一步 clamp 到 margin
    expect(r.left).toBe(8)
    expect(r.top).toBe(8)
  })
})
