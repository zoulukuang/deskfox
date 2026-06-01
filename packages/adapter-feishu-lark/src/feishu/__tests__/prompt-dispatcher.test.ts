// [fork-only] PromptDispatcher 单测
// [feat: feishu-llm-timeout-surface] 2026-06-01
//
// 起源:2026-05-31 用户撞 "bot 收到消息但不回",根因是 dispatcher 30 分钟超时
// 时即使 partial 完全空(provider 链路 hang 无任何输出)也 resolve("")—— 上层
// 静默把空字符串当正常 reply 丢弃。本文件覆盖 dispatcher 6 个核心路径,把 R5
// 双清单 Logic 类的空白补上(prompt-dispatcher 是核心 logic 但 v6.2 前无 test)。
//
// [bug-repro: bot 收到消息后 30 分钟超时静默丢弃 → 用户拿不到任何反馈]
//   - test "timeout 无 partial → reject(非 resolve 空字符串)" 锁住核心修复

import { describe, expect, test } from "bun:test"
import { PromptDispatcher, type DispatchResult } from "../prompt-dispatcher"

describe("PromptDispatcher — opencode plugin event ↔ waiter 桥梁", () => {
  test("session.idle → resolve { reply: 累积 text, source: 'session.idle' }", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_1", 1000)

    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "part_a", sessionID: "ses_1", type: "text", text: "hello " },
      },
    })
    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "part_b", sessionID: "ses_1", type: "text", text: "world" },
      },
    })
    d.dispatch({ type: "session.idle", properties: { sessionID: "ses_1" } })

    const result: DispatchResult = await p
    expect(result.reply).toBe("hello \nworld")
    expect(result.source).toBe("session.idle")
  })

  test("session.error → reject 带 error.message", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_2", 1000)
    d.dispatch({
      type: "session.error",
      properties: {
        sessionID: "ses_2",
        error: { message: "401 OAuth token expired" },
      },
    })
    await expect(p).rejects.toThrow("401 OAuth token expired")
  })

  test("session.error 无 message → reject 带 fallback 文案", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_3", 1000)
    d.dispatch({
      type: "session.error",
      properties: { sessionID: "ses_3" },
    })
    await expect(p).rejects.toThrow("opencode session error")
  })

  // [bug-repro] 这条是本次修复的核心断言 ——
  // 旧代码:timeout 时 collectText 为空 → reject(已正确,代码 line 63);
  //         但 timeout-partial 是空字符串时(累积过 0 长度 part)走 resolve("")—— 上层吞掉。
  // 新代码:统一为 partial.trim() 后空 → 一律 reject,确保上层一定能感知到"无输出"信号。
  test("[bug-repro] timeout 时 partial 累积过 0 长度 part(trim 后空)→ reject 而非 resolve('')", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_4", 50) // 50ms 超时,快测

    // 模拟 LLM 发了 step-start / step-finish 但 text 全是空白,trim 后无内容
    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "part_x", sessionID: "ses_4", type: "text", text: "" },
      },
    })
    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "part_y", sessionID: "ses_4", type: "text", text: "   \n  " },
      },
    })
    // 不发 session.idle,等 timeout

    await expect(p).rejects.toThrow(/timeout/i)
  })

  test("timeout 时有真实 partial(非空) → resolve { reply: partial, source: 'timeout-partial' }", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_5", 50)

    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "part_z", sessionID: "ses_5", type: "text", text: "partial 内容已累积一半" },
      },
    })
    // 不发 idle,等 timeout

    const result = await p
    expect(result.reply).toBe("partial 内容已累积一半")
    expect(result.source).toBe("timeout-partial")
  })

  test("timeout 时 buffer 完全空(没收过任何 part)→ reject 带 timeoutMs 数值便于诊断", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_6", 50)
    // 一个 dispatch 都不发,纯 hang

    await expect(p).rejects.toThrow(/50/) // timeoutMs=50 应该出现在 error message 里
  })

  test("同一 sessionID 二次 register → 旧的 reject('superseded'),新的独立等待", async () => {
    const d = new PromptDispatcher()
    const p1 = d.register("ses_7", 1000)
    const p2 = d.register("ses_7", 1000)

    await expect(p1).rejects.toThrow("superseded")

    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "part_n", sessionID: "ses_7", type: "text", text: "new prompt reply" },
      },
    })
    d.dispatch({ type: "session.idle", properties: { sessionID: "ses_7" } })

    const result = await p2
    expect(result.reply).toBe("new prompt reply")
  })

  test("abortAll → 所有 pending reject('dispatcher aborted')", async () => {
    const d = new PromptDispatcher()
    const p1 = d.register("ses_a", 10_000)
    const p2 = d.register("ses_b", 10_000)
    expect(d.pending).toBe(2)

    d.abortAll()
    expect(d.pending).toBe(0)

    await expect(p1).rejects.toThrow("dispatcher aborted")
    await expect(p2).rejects.toThrow("dispatcher aborted")
  })

  test("delta 增量 part 累积(非 cumulative text)", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_delta", 1000)
    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "p1", sessionID: "ses_delta", type: "text" },
        delta: "Hel",
      },
    })
    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "p1", sessionID: "ses_delta", type: "text" },
        delta: "lo!",
      },
    })
    d.dispatch({ type: "session.idle", properties: { sessionID: "ses_delta" } })

    const result = await p
    expect(result.reply).toBe("Hello!")
  })

  test("非 text part 类型(reasoning / tool) → 忽略", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_skip", 1000)
    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "r1", sessionID: "ses_skip", type: "reasoning", text: "thinking..." },
      },
    })
    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "t1", sessionID: "ses_skip", type: "text", text: "real reply" },
      },
    })
    d.dispatch({ type: "session.idle", properties: { sessionID: "ses_skip" } })

    const result = await p
    expect(result.reply).toBe("real reply")
  })
})
