// FORK-ONLY: stuck-working-status-reconcile [feat: stuck-working-status-reconcile] 2026-06-12
//
// 后端 session.status() 是会话忙闲的权威源,且只返回非 idle 的 session(idle 的在
// SessionStatus.set 里被 delete 出内存 Map)。前端的 session_status 缓存却可能残留一条
// busy —— 进程被硬杀 / 生成中途断流 / sidecar 看门狗重启时,后端来不及(或新进程根本不
// 知道要)补发 `session.status idle` 事件,前端那条乐观 busy 就永远刷不掉,主视图永久
// 「思考中」+ 停止按钮卡死。
//
// 对账 = 用后端权威结果整体替换前端缓存:后端没上报的 session 一律按 idle 处理、清掉。
// 本模块只做「算出权威表 + 列出被清掉的残留 busy」的纯计算(Logic 清单可单测),实际写回
// 由调用方用 reconcile(next, { merge: false }) 完成 —— 裸 setStore 是 merge,清不掉残留。
// 详见 docs/features/stuck-working-status-reconcile/

import type { Message, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { reconcile, type SetStoreFunction } from "solid-js/store"
import type { State } from "./types"

export function reconcileSessionStatus(
  current: Record<string, SessionStatus | undefined>,
  authoritative: Record<string, SessionStatus | undefined> | null | undefined,
): { next: Record<string, SessionStatus>; cleared: string[] } {
  const next: Record<string, SessionStatus> = {}
  for (const [id, status] of Object.entries(authoritative ?? {})) {
    if (!status || status.type === "idle") continue
    next[id] = status
  }
  const cleared: string[] = []
  for (const [id, status] of Object.entries(current)) {
    if (!status || status.type === "idle") continue
    if (!next[id]) cleared.push(id)
  }
  return { next, cleared }
}

/**
 * 把后端 session.status() 的权威结果写回前端 store:用 reconcile 整体替换(merge:false),
 * 清掉后端不再上报的残留 busy —— 裸 setStore 是 merge,清不掉残留 key 是卡死根因。
 * 返回被清掉的残留 busy id(供日志/测试)。bootstrap 对账只此一行,逻辑全在这里可单测。
 */
export function applyReconciledSessionStatus(
  store: Pick<State, "session_status">,
  setStore: SetStoreFunction<State>,
  data: Record<string, SessionStatus | undefined> | null | undefined,
): string[] {
  const { next, cleared } = reconcileSessionStatus(store.session_status, data)
  if (cleared.length) console.warn("[session-status] cleared stale busy after reconcile", cleared)
  setStore("session_status", reconcile(next, { merge: false }))
  return cleared
}

/**
 * 纯函数:一组消息里,末条是否是「未完成的 assistant 残骸」。是则返回其下标,否则 -1。
 * 与侧边栏 deriveSessionWorking 的 pending 判定同口径(只看末条),可单测。
 */
export function trailingOrphanIndex(messages: ReadonlyArray<Message> | undefined): number {
  if (!messages?.length) return -1
  const i = messages.length - 1
  const last = messages[i]
  if (last?.role !== "assistant") return -1
  if (typeof last.time?.completed === "number") return -1
  return i
}

/**
 * session_status 对账清掉某会话 stale busy = 后端已确认它 idle。但 sidecar 崩溃/重启时,
 * 它正在生成的末条 assistant 消息没盖 `time.completed` → 残骸,侧边栏 deriveSessionWorking
 * 仍判 pending 永久转圈(2026-06-06 的后端 heal-interrupted 挂在「消息 GET 时补盖」,重连
 * 后前端不重新 GET 已打开会话的消息,故不触发)。这里镜像它:对被清的会话,把末条残骸在前端
 * store 补盖 `completed=created`(保留原始时序,不伪造时长)。只对「后端已 idle」的会话做,
 * 绝不误伤健康直播流(那种 status 仍 busy、不会进 cleared)。返回实际补盖的会话 id。
 */
export function healClearedSessionOrphans(
  store: Pick<State, "message">,
  setStore: SetStoreFunction<State>,
  clearedSessionIDs: ReadonlyArray<string>,
): string[] {
  const healed: string[] = []
  for (const sid of clearedSessionIDs) {
    const messages = store.message[sid]
    const idx = trailingOrphanIndex(messages)
    if (idx < 0) continue
    const created = messages![idx].time?.created
    const completed = typeof created === "number" ? created : Date.now()
    setStore("message", sid, idx, "time", "completed" as never, completed as never)
    healed.push(sid)
  }
  if (healed.length) console.warn("[session-status] healed trailing orphan messages after reconcile", healed)
  return healed
}
