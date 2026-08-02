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

  // ── [fix: feishu-llm-stall-fastfail 2026-06-07] 首字节活动快速失败 ──
  //
  // [bug-repro: provider 卡在可重试错误(getbot 503)不发任何 part 也不报 error,
  //  dispatcher 干等 30min 硬超时,期间同 chat 串行队列被堵死 → 整个飞书聊天失联直到重启]

  test("[bug-repro] 首字节窗口内毫无 part → 提前 reject(不等满 timeoutMs)", async () => {
    const d = new PromptDispatcher()
    // 主超时 10s(模拟生产 30min 那种长),首字节窗口 60ms
    const t0 = Date.now()
    const p = d.register("ses_stall", 10_000, 60)
    // 一个 dispatch 都不发(模拟 provider 卡死无输出)

    await expect(p).rejects.toThrow(/首字节超时|无任何输出/)
    const elapsed = Date.now() - t0
    // 关键:必须在首字节窗口附近 reject,远早于主超时 10s(证明队列被及时释放)
    expect(elapsed).toBeLessThan(2000)
  })

  test("[bug-repro] 首字节 reject 文案含「超时」+「无任何输出」→ 命中 friendlyErrorReply timeout pattern", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_stall_msg", 10_000, 30)
    let msg = ""
    try {
      await p
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toContain("超时")
    expect(msg).toContain("无任何输出")
  })

  test("首字节窗口内有 part 活动 → 取消快速失败,继续按主超时走(不误杀长任务)", async () => {
    const d = new PromptDispatcher()
    // 首字节窗口 50ms,主超时 250ms;在窗口内发一个 part → 应清掉快速失败
    const p = d.register("ses_active", 250, 50)
    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "p1", sessionID: "ses_active", type: "text", text: "正在干活" },
      },
    })
    // 不发 idle → 走主超时 250ms 的 timeout-partial(证明没被首字节快速失败干掉)
    const result = await p
    expect(result.reply).toBe("正在干活")
    expect(result.source).toBe("timeout-partial")
  })

  test("首字节窗口内即便是 reasoning/tool part 也算活动 → 取消快速失败", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_active_tool", 250, 50)
    // 先来 reasoning part(非 text),也应清掉首字节定时器
    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "r1", sessionID: "ses_active_tool", type: "reasoning", text: "思考中" },
      },
    })
    d.dispatch({
      type: "message.part.updated",
      properties: {
        part: { id: "t1", sessionID: "ses_active_tool", type: "text", text: "答案" },
      },
    })
    d.dispatch({ type: "session.idle", properties: { sessionID: "ses_active_tool" } })
    const result = await p
    // 正常 resolve(没被首字节 reject),reply = text part
    expect(result.reply).toBe("答案")
    expect(result.source).toBe("session.idle")
  })

  test("firstActivityTimeoutMs 默认 120s + 上限不超过 timeoutMs(小 timeout 不被反超)", async () => {
    const d = new PromptDispatcher()
    // timeout=40ms,默认 firstActivity=120s → 取 min=40ms,无 part 时 40ms 左右 reject
    const t0 = Date.now()
    const p = d.register("ses_cap", 40)
    await expect(p).rejects.toThrow()
    expect(Date.now() - t0).toBeLessThan(1500)
  })
})

// ── [feat: feishu-retry-feedback] REQ-093 — session.status retry 事件 ──

function retryEvent(sessionID: string, attempt: number, message = "503 overloaded"): { type: string; properties: Record<string, unknown> } {
  return {
    type: "session.status",
    properties: { sessionID, status: { type: "retry", attempt, message, next: 0 } },
  }
}

describe("PromptDispatcher — retry 事件(REQ-093)", () => {
  test("T1: retry 事件触发 onRetry,收到 attempt/message", async () => {
    const d = new PromptDispatcher()
    const seen: Array<{ attempt: number; message?: string; next?: number }> = []
    const p = d.register("ses_r1", 10_000, 10_000, (info) => seen.push(info))

    d.dispatch(retryEvent("ses_r1", 1))
    d.dispatch(retryEvent("ses_r1", 2, "rate limited"))

    expect(seen).toEqual([
      { attempt: 1, message: "503 overloaded", next: 0 },
      { attempt: 2, message: "rate limited", next: 0 },
    ])
    d.dispatch({ type: "session.idle", properties: { sessionID: "ses_r1" } })
    await p
  })

  test("T2: retry 事件重置 fastfail 窗口(原窗口点不 reject)", async () => {
    const d = new PromptDispatcher()
    // 首字节窗口 120ms;60ms 时来 retry 事件 → 窗口重开,原 120ms 点不应 reject
    const p = d.register("ses_r2", 10_000, 120)
    let settled = false
    p.catch(() => {}).finally(() => (settled = true))

    await new Promise((r) => setTimeout(r, 60))
    d.dispatch(retryEvent("ses_r2", 1))
    await new Promise((r) => setTimeout(r, 90)) // t=150ms > 原窗口 120ms,但距 retry 仅 90ms
    expect(settled).toBe(false)

    d.dispatch({ type: "session.idle", properties: { sessionID: "ses_r2" } })
    await p
  })

  test("T3: retry 后仍无 activity 超窗 → reject 文案含「已自动重试 N 次」", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_r3", 10_000, 60)
    d.dispatch(retryEvent("ses_r3", 1))
    d.dispatch(retryEvent("ses_r3", 2))
    await expect(p).rejects.toThrow(/已自动重试 2 次/)
  })

  test("T4: 真实 part 已清 fastfail 后,retry 事件不再重装定时器(长任务不误伤)", async () => {
    const d = new PromptDispatcher()
    const p = d.register("ses_r4", 10_000, 60)
    // 真实 part 到达 → 清 fastfail
    d.dispatch({
      type: "message.part.updated",
      properties: { part: { id: "pa", sessionID: "ses_r4", type: "text", text: "部分输出" } },
    })
    // 之后来 retry(如输出后 provider 断流重试)→ 不应重装 fastfail
    d.dispatch(retryEvent("ses_r4", 1))
    await new Promise((r) => setTimeout(r, 100)) // 超过 faMs=60ms
    d.dispatch({ type: "session.idle", properties: { sessionID: "ses_r4" } })
    const result = await p
    expect(result.reply).toBe("部分输出")
  })

  test("T7: 无 waiter 的 session 收到 retry 事件 → 静默忽略不 crash", () => {
    const d = new PromptDispatcher()
    expect(() => d.dispatch(retryEvent("ses_unknown", 1))).not.toThrow()
  })
})
