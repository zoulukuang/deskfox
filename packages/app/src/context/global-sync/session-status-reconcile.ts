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

import type { SessionStatus } from "@opencode-ai/sdk/v2/client"
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
