// FORK-ONLY: stuck-working-indicator-fix [feat: stuck-working-indicator-fix] 2026-06-06
//
// 进程被硬杀(SIGKILL/崩溃/休眠)时,正在生成的 assistant 消息来不及盖 `time.completed`
// (processor.ts 的 Effect.ensuring(cleanup) finalizer 没机会跑),留下永久"未完成"残骸消息。
// 前端 isWorking() 把任何缺 completed 的 assistant 消息判为"运行中" → 旋转图标永久卡死。
//
// 本模块在 session 处于 idle(无活跃 runner)时,把残骸消息补盖 completed —— 自愈现有坏数据
// + 防复发,且 provider 无关(飞书桥接等任何 provider 硬中断都适用)。
// 详见 docs/features/stuck-working-indicator-fix/

import { Effect } from "effect"
import { Session } from "./session"
import { SessionStatus } from "./status"
// FORK: 上游 #30473 把 v1 消息 schema 迁入 core,WithParts/Assistant 不再是 MessageV2 命名空间成员 [feat: electron-replatform]
import { Assistant, WithParts } from "@opencode-ai/core/v1/session"
import { SessionID } from "./schema"

/**
 * 纯函数:从一批消息里挑出"未完成的 assistant 残骸"——role 为 assistant 且 time.completed
 * 不是有效数字。可单独单测(Logic 清单)。
 */
export function findInterrupted(messages: WithParts[]): Assistant[] {
  const result: Assistant[] = []
  for (const msg of messages) {
    const info = msg.info
    if (info.role !== "assistant") continue
    if (typeof info.time?.completed === "number") continue
    result.push(info)
  }
  return result
}

/**
 * 纯函数:给定消息和 session 是否 idle,算出补盖计划。
 * - 非 idle(busy/retry)→ 不动,toUpdate 空、messages 原样返回(绝不误伤直播流式在途消息)。
 * - idle → 残骸补盖 time.completed = time.created(保留原始时序、不伪造时长),
 *   返回需持久化的消息列表 + 修正后的整组消息(让 HTTP 响应直接带 completed,前端本次加载即收口)。
 * 把全部判定/映射放纯函数里,Effect 壳只剩持久化,便于单测(Logic 清单)。
 */
export function planHeal(
  messages: WithParts[],
  isIdle: boolean,
): { toUpdate: Assistant[]; messages: WithParts[] } {
  if (!isIdle) return { toUpdate: [], messages }
  const interrupted = findInterrupted(messages)
  if (interrupted.length === 0) return { toUpdate: [], messages }
  const healed = new Map<string, Assistant>()
  for (const info of interrupted) {
    healed.set(info.id, { ...info, time: { ...info.time, completed: info.time.created } })
  }
  return {
    toUpdate: [...healed.values()],
    messages: messages.map((msg) => {
      const fixed = healed.get(msg.info.id)
      return fixed ? { ...msg, info: fixed } : msg
    }),
  }
}

/**
 * Effect 壳:查 session 当前状态 → planHeal → 持久化补盖的消息 → 返回修正后的消息数组。
 * Session / SessionStatus 服务从 Effect context 解析。
 */
export const healInterrupted = Effect.fn("Session.healInterrupted")(function* (input: {
  sessionID: SessionID
  messages: WithParts[]
}) {
  const status = yield* SessionStatus.Service
  const current = yield* status.get(input.sessionID)
  const plan = planHeal(input.messages, current.type === "idle")
  if (plan.toUpdate.length === 0) return plan.messages
  const session = yield* Session.Service
  for (const info of plan.toUpdate) {
    yield* session.updateMessage(info)
  }
  return plan.messages
})

export * as HealInterrupted from "./heal-interrupted"
