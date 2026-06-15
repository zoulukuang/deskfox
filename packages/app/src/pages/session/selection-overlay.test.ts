// [fork-only] 选区 overlay 几何工具单测 [feat: viewer-selection-tray-style] 2026-06-14
import { describe, expect, test } from "bun:test"
import { clampRectsToBounds, projectIframeRects } from "./selection-overlay"

const bounds = { left: 100, top: 100, right: 500, bottom: 400 }

describe("clampRectsToBounds", () => {
  test("完全在界内 → 原样保留", () => {
    const r = [{ left: 150, top: 150, width: 100, height: 50 }]
    expect(clampRectsToBounds(r, bounds)).toEqual(r)
  })

  test("超出右边界 → 裁掉超出的宽度(防 CSV grid 横向铺满溢出)", () => {
    const r = [{ left: 400, top: 150, width: 300, height: 50 }] // right=700 > 500
    expect(clampRectsToBounds(r, bounds)).toEqual([{ left: 400, top: 150, width: 100, height: 50 }])
  })

  test("超出左边界 → 裁掉左侧(防溢出文件树)", () => {
    const r = [{ left: 0, top: 150, width: 200, height: 50 }] // left=0 < 100
    expect(clampRectsToBounds(r, bounds)).toEqual([{ left: 100, top: 150, width: 100, height: 50 }])
  })

  test("超出下边界 → 裁掉底部(防溢出聊天区)", () => {
    const r = [{ left: 150, top: 350, width: 100, height: 200 }] // bottom=550 > 400
    expect(clampRectsToBounds(r, bounds)).toEqual([{ left: 150, top: 350, width: 100, height: 50 }])
  })

  test("完全在界外 → 丢弃", () => {
    const r = [{ left: 600, top: 150, width: 100, height: 50 }] // left>right bound
    expect(clampRectsToBounds(r, bounds)).toEqual([])
  })

  test("多矩形混合 → 各自裁剪,界外丢弃", () => {
    const r = [
      { left: 150, top: 150, width: 50, height: 50 }, // 界内
      { left: 450, top: 150, width: 200, height: 50 }, // 右超 → 裁到 50
      { left: 700, top: 150, width: 50, height: 50 }, // 界外 → 丢
    ]
    expect(clampRectsToBounds(r, bounds)).toEqual([
      { left: 150, top: 150, width: 50, height: 50 },
      { left: 450, top: 150, width: 50, height: 50 },
    ])
  })

  test("空输入 → 空输出", () => {
    expect(clampRectsToBounds([], bounds)).toEqual([])
  })
})

describe("projectIframeRects", () => {
  test("加 iframe 左上偏移投影到父文档坐标", () => {
    const r = [{ left: 10, top: 20, width: 100, height: 30 }]
    expect(projectIframeRects(r, { left: 200, top: 80 })).toEqual([
      { left: 210, top: 100, width: 100, height: 30 },
    ])
  })

  test("零偏移 → 原样", () => {
    const r = [{ left: 5, top: 5, width: 10, height: 10 }]
    expect(projectIframeRects(r, { left: 0, top: 0 })).toEqual(r)
  })

  test("宽高不受偏移影响,只平移", () => {
    const r = [{ left: 0, top: 0, width: 50, height: 25 }]
    const out = projectIframeRects(r, { left: 33, top: 44 })
    expect(out[0]).toEqual({ left: 33, top: 44, width: 50, height: 25 })
  })

  test("空数组 → 空", () => {
    expect(projectIframeRects([], { left: 100, top: 100 })).toEqual([])
  })
})
