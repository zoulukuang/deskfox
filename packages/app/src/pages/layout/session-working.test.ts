// FORK-ONLY test: stuck-working-indicator-fix [feat: stuck-working-indicator-fix]
import { describe, expect, test } from "bun:test"
import { deriveSessionWorking } from "./session-working"

const userMsg = { role: "user", time: { created: 1 } }
const doneAssistant = { role: "assistant", time: { created: 2, completed: 3 } }
const stuckAssistant = { role: "assistant", time: { created: 2 } } // 残骸:无 completed

describe("deriveSessionWorking", () => {
  // 用例 6:末条已完成、历史里有残骸 → 不转圈
  test("埋在历史里的残骸不触发运行中", () => {
    const messages = [userMsg, stuckAssistant, userMsg, doneAssistant]
    expect(deriveSessionWorking({ hasPermissions: false, messages, status: undefined })).toBe(false)
  })

  // 用例 7:末条是未完成 assistant(直播流式中)→ 转圈
  test("最后一条是未完成 assistant 则运行中", () => {
    const messages = [userMsg, stuckAssistant]
    expect(deriveSessionWorking({ hasPermissions: false, messages, status: undefined })).toBe(true)
  })

  // 用例 8:session_status=busy → 转圈(即使消息看起来完成)
  test("status=busy 则运行中", () => {
    const messages = [userMsg, doneAssistant]
    expect(deriveSessionWorking({ hasPermissions: false, messages, status: { type: "busy" } })).toBe(true)
  })

  test("status=retry 则运行中", () => {
    expect(deriveSessionWorking({ hasPermissions: false, messages: [doneAssistant], status: { type: "retry" } })).toBe(
      true,
    )
  })

  test("status=idle 且消息已完成 → 不运行", () => {
    expect(deriveSessionWorking({ hasPermissions: false, messages: [doneAssistant], status: { type: "idle" } })).toBe(
      false,
    )
  })

  test("有待处理权限请求 → 永不运行(优先级最高)", () => {
    const messages = [userMsg, stuckAssistant]
    expect(deriveSessionWorking({ hasPermissions: true, messages, status: { type: "busy" } })).toBe(false)
  })

  test("空消息 + 无状态 → 不运行", () => {
    expect(deriveSessionWorking({ hasPermissions: false, messages: [], status: undefined })).toBe(false)
    expect(deriveSessionWorking({ hasPermissions: false, messages: undefined, status: undefined })).toBe(false)
  })
})
