// FORK: REQ-119 — 聊天引用伪路径判定的单元测试 [feat: req-119-chat-selection-pseudo-path] 2026-08-19
import { describe, expect, test } from "bun:test"
import { CHAT_SELECTION_PATH, isChatSelectionPath } from "@opencode-ai/core/util/chat-selection"

describe("isChatSelectionPath", () => {
  test("裸伪路径命中", () => {
    expect(isChatSelectionPath(CHAT_SELECTION_PATH)).toBe(true)
  })

  test("拼到 cwd 后面(posix)命中", () => {
    expect(isChatSelectionPath("/home/user/project/" + CHAT_SELECTION_PATH)).toBe(true)
  })

  test("拼到 cwd 后面(Windows 反斜杠)命中", () => {
    expect(isChatSelectionPath("D:\\my-life\\" + CHAT_SELECTION_PATH)).toBe(true)
  })

  test("Windows 正斜杠形态命中", () => {
    expect(isChatSelectionPath("D:/my-life/" + CHAT_SELECTION_PATH)).toBe(true)
  })

  test("前后空白不影响判定", () => {
    expect(isChatSelectionPath("  /repo/" + CHAT_SELECTION_PATH + "  ")).toBe(true)
  })

  test("真实文件路径不误伤", () => {
    expect(isChatSelectionPath("/repo/src/app.ts")).toBe(false)
    expect(isChatSelectionPath("D:\\repo\\README.md")).toBe(false)
  })

  test("同名前缀 / 中间段不误判", () => {
    // 目录名恰好叫伪路径,但目标是它下面的真实文件 → 不该短路
    expect(isChatSelectionPath("/repo/" + CHAT_SELECTION_PATH + "/real.ts")).toBe(false)
    expect(isChatSelectionPath("/repo/<chat selection>.ts")).toBe(false)
  })

  test("空值 / 空串安全", () => {
    expect(isChatSelectionPath(undefined)).toBe(false)
    expect(isChatSelectionPath(null)).toBe(false)
    expect(isChatSelectionPath("")).toBe(false)
    expect(isChatSelectionPath("   ")).toBe(false)
  })
})
