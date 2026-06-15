// FORK-ONLY test: stuck-working-indicator-fix [feat: stuck-working-indicator-fix]
import { describe, expect, test } from "bun:test"
import { findInterrupted, planHeal } from "../../src/session/heal-interrupted"
// FORK: 上游 #30473 v1 消息 schema 迁入 core;ID 类型仅 fixture 用,裸字符串(对象整体 as unknown 强转) [feat: electron-replatform]
import { Assistant, User, WithParts } from "@opencode-ai/core/v1/session"
import { SessionID } from "../../src/session/schema"

const sessionID = SessionID.make("ses_test")
const providerID = "claude-code"

function user(id: string): WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 100 },
      agent: "user",
      model: { providerID, modelID: "opus" },
      tools: {},
      mode: "",
    } as unknown as User,
    parts: [],
  }
}

function assistant(id: string, completed?: number): WithParts {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: completed === undefined ? { created: 200 } : { created: 200, completed },
      parentID: "msg_parent",
      modelID: "opus",
      providerID,
      mode: "",
      agent: "build",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    } as unknown as Assistant,
    parts: [],
  }
}

describe("heal-interrupted.findInterrupted", () => {
  // 用例 1:含 1 条残骸 + 正常消息 → 只返回残骸
  test("挑出无 completed 的 assistant 残骸", () => {
    const msgs = [user("u1"), assistant("a1", 300), assistant("a2" /* 残骸 */), user("u2")]
    const result = findInterrupted(msgs)
    expect(result.map((m) => String(m.id))).toEqual(["a2"])
  })

  // 用例 2:全部正常 / 纯 user → 空
  test("无残骸时返回空", () => {
    expect(findInterrupted([user("u1"), assistant("a1", 300)])).toEqual([])
    expect(findInterrupted([user("u1"), user("u2")])).toEqual([])
    expect(findInterrupted([])).toEqual([])
  })

  // 用例 3:多条残骸 → 全返回
  test("多条残骸全部返回", () => {
    const result = findInterrupted([assistant("a1"), user("u1"), assistant("a2")])
    expect(result.map((m) => String(m.id))).toEqual(["a1", "a2"])
  })
})

describe("heal-interrupted.planHeal", () => {
  // 用例 4:idle 时补盖 completed = created
  test("idle 时残骸补盖 completed=created 且修正返回数组", () => {
    const msgs = [user("u1"), assistant("a-stuck")]
    const plan = planHeal(msgs, true)
    expect(plan.toUpdate.map((m) => String(m.id))).toEqual(["a-stuck"])
    expect(plan.toUpdate[0].time.completed).toBe(200) // = created
    const healedInfo = plan.messages[1].info as Assistant
    expect(healedInfo.time.completed).toBe(200)
  })

  // 用例 5:busy 时整体跳过,不误伤在途消息
  test("非 idle 时不补盖、原样返回", () => {
    const msgs = [user("u1"), assistant("a-inflight")]
    const plan = planHeal(msgs, false)
    expect(plan.toUpdate).toEqual([])
    expect(plan.messages).toBe(msgs) // 原引用,零改动
  })

  // 用例 4b:idle 但无残骸 → 不动
  test("idle 无残骸时不动", () => {
    const msgs = [user("u1"), assistant("a1", 300)]
    const plan = planHeal(msgs, true)
    expect(plan.toUpdate).toEqual([])
    expect(plan.messages).toBe(msgs)
  })

  // 正常消息在补盖时不被改动
  test("补盖只动残骸,正常消息引用不变", () => {
    const ok = assistant("a-ok", 300)
    const msgs = [user("u1"), ok, assistant("a-stuck")]
    const plan = planHeal(msgs, true)
    expect(plan.messages[1]).toBe(ok) // 正常消息保持原引用
    expect(plan.messages[2]).not.toBe(msgs[2]) // 残骸被替换
  })
})
