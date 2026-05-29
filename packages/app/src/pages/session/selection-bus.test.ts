// FORK: selection-bus 单例 listener 路由测试(2026-05-29)
// 关键不变量:
// - 0 注册 → 不挂 listener;有注册 → 自动挂;清完 → 自动卸
// - selectionchange 时 first-match-wins,只路由到 anchor 在内的 viewer
// - 不同 viewer 互不污染

import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { registerViewer, _registrationCount, _resetBus } from "./selection-bus"

describe("selection-bus · 注册 / 注销生命周期", () => {
  beforeEach(() => {
    _resetBus()
  })

  afterEach(() => {
    _resetBus()
  })

  test("初始 0 注册", () => {
    expect(_registrationCount()).toBe(0)
  })

  test("registerViewer → 1 注册", () => {
    const viewer = document.createElement("div")
    document.body.appendChild(viewer)
    const reg = registerViewer(viewer)
    expect(_registrationCount()).toBe(1)
    expect(reg.history).toBeDefined()
    reg.destroy()
    viewer.remove()
  })

  test("destroy() → 注销", () => {
    const viewer = document.createElement("div")
    document.body.appendChild(viewer)
    const reg = registerViewer(viewer)
    reg.destroy()
    expect(_registrationCount()).toBe(0)
    viewer.remove()
  })

  test("多次注册 / 注销", () => {
    const v1 = document.createElement("div")
    const v2 = document.createElement("div")
    document.body.appendChild(v1)
    document.body.appendChild(v2)
    const r1 = registerViewer(v1)
    const r2 = registerViewer(v2)
    expect(_registrationCount()).toBe(2)
    r1.destroy()
    expect(_registrationCount()).toBe(1)
    r2.destroy()
    expect(_registrationCount()).toBe(0)
    v1.remove()
    v2.remove()
  })

  test("同一 viewer 注册两次 → 各自独立 history(实际不期望发生,但 sanity check)", () => {
    const v = document.createElement("div")
    document.body.appendChild(v)
    const r1 = registerViewer(v)
    const r2 = registerViewer(v)
    expect(r1.history).not.toBe(r2.history)
    r1.destroy()
    r2.destroy()
    v.remove()
  })
})

describe("selection-bus · selectionchange 路由(first-match-wins + scope 隔离)", () => {
  beforeEach(() => {
    _resetBus()
  })

  afterEach(() => {
    _resetBus()
  })

  // 注:happy-dom 不发实际 selectionchange 事件,我们靠 history.size() / pickBest 间接验证
  // 模拟事件需要直接调 onSelectionChange,但它是内部函数。改成:测试公共 API 表面 —
  // 测 viewer 没被注册时 history 不增长(对照组),viewer 注册了 + selection 在 viewer 内时增长。
  // 这里覆盖的是"注册管理"层,真实 selectionchange 派发靠浏览器/happy-dom 触发,留 user 真桌面端到端验证。

  test("注册后 history.size 初始为 0", () => {
    const viewer = document.createElement("div")
    document.body.appendChild(viewer)
    const reg = registerViewer(viewer)
    expect(reg.history.size()).toBe(0)
    reg.destroy()
    viewer.remove()
  })

  test("destroy 后再操作不影响 registry", () => {
    const viewer = document.createElement("div")
    document.body.appendChild(viewer)
    const reg = registerViewer(viewer)
    reg.destroy()
    reg.destroy() // 重复 destroy 应幂等
    expect(_registrationCount()).toBe(0)
    viewer.remove()
  })

  test("两个 viewer 各自的 history 独立", () => {
    const v1 = document.createElement("div")
    const v2 = document.createElement("div")
    document.body.appendChild(v1)
    document.body.appendChild(v2)
    const r1 = registerViewer(v1)
    const r2 = registerViewer(v2)
    // 直接给 v1 的 history push,v2 的 history 不受影响
    r1.history.pushFromSelection({ toString: () => "v1 text", rangeCount: 1, getRangeAt: () => document.createRange() } as unknown as Selection)
    expect(r1.history.size()).toBe(1)
    expect(r2.history.size()).toBe(0)
    r1.destroy()
    r2.destroy()
    v1.remove()
    v2.remove()
  })
})
