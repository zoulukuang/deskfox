// REQ-082: isImeComposingEvent 单测 —— 浮窗裸 Enter 提交前的 IME 组合态守卫
import { describe, expect, test } from "bun:test"
import { isImeComposingEvent } from "./ime"

// 用最小 KeyboardEvent 桩(只喂 isImeComposingEvent 读的两枚字段)
function evt(opts: { isComposing?: boolean; keyCode?: number }): KeyboardEvent {
  return { isComposing: opts.isComposing ?? false, keyCode: opts.keyCode ?? 13 } as KeyboardEvent
}

describe("isImeComposingEvent", () => {
  // TC-B1a:标准 IME 组合态(isComposing=true)→ 判为组合中 → 浮窗应跳过提交
  test("TC-B1a: isComposing=true is composing", () => {
    expect(isImeComposingEvent(evt({ isComposing: true }))).toBe(true)
  })

  // TC-B1b:只给 keyCode 229 不给 isComposing(部分旧版/中日韩 IME)→ 仍判为组合中
  test("TC-B1b: keyCode 229 without isComposing is composing", () => {
    expect(isImeComposingEvent(evt({ isComposing: false, keyCode: 229 }))).toBe(true)
  })

  // TC-B1c:普通裸 Enter(isComposing=false, keyCode=13)→ 非组合态 → 可提交
  test("TC-B1c: plain Enter is not composing", () => {
    expect(isImeComposingEvent(evt({ isComposing: false, keyCode: 13 }))).toBe(false)
  })

  // TC-B1d:两枚同时命中也判为组合中(冗余安全)
  test("TC-B1d: both flags set is composing", () => {
    expect(isImeComposingEvent(evt({ isComposing: true, keyCode: 229 }))).toBe(true)
  })
})
