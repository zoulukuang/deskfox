// FORK-ONLY: REQ-100 ②③ 残留 busy 判定(纯逻辑)
// [feat: release-closeout-2026-09] 2026-09-17
//
// 从 server-sync.tsx 的全量对账里抽出的决策部分,便于单测(R5 双清单:Logic 清单)。
//
// 背景 —— 为什么忙闲对账不能按目录切:
//   2026-08-18 真机,后端 respawn 后前端重连并重跑了 6 个目录的 bootstrap,但出事的那个目录
//   被 child store 的 eviction 挤掉了,而重连对账的循环有 `if (!children.active(dir)) continue`,
//   于是它永远拿不到对账,名下会话的残留 busy 永不清除(实测卡 ≥38 分钟)。
//   忙闲本来就是**会话**维度的,后端 SessionStatus 也确实维护着一张全局表。
//
// 后端语义(packages/opencode/src/session/status.ts):该表**只存非 idle 项** —— `set` 到 idle
//   会把条目 delete 掉,`get` 对缺失项返回 idle。所以「不在表里 = idle」是确定语义,不是猜测。
//   而且它是 per-instance 内存态:sidecar 一旦 respawn,表就是空的 —— 正对应"该清干净"的场景。

export type LocalSessionStatus = { type: string } | undefined

export type StaleBusyInput = {
  /** 本地缓存的会话忙闲表 */
  local: Record<string, LocalSessionStatus>
  /** 后端权威表:sessionID → 是否非 idle。缺席即 idle */
  remote: Record<string, boolean>
  /** 该会话是否有未确认的乐观消息(刚发出、后端还没登记)*/
  pending: (sessionID: string) => boolean
}

/**
 * 挑出「本地显示忙、后端说不忙」的会话 —— 这些就是要被清成 idle 的残留。
 *
 * 三条不清的情形:
 *   ① 本地本来就不是 busy —— 没什么可清
 *   ② 后端也说忙 —— 人家真在跑
 *   ③ 有未确认的乐观消息 —— 这一发还在飞。前端已乐观置 busy,后端还没把它登记进 status 表,
 *      此刻对账撞进来会把正在发送的会话错误清掉转圈。这是唯一的竞态窗口,必须挡住。
 */
export function collectStaleBusySessions(input: StaleBusyInput): string[] {
  const stale: string[] = []
  for (const [sessionID, status] of Object.entries(input.local)) {
    if (status?.type !== "busy") continue
    if (input.remote[sessionID]) continue
    if (input.pending(sessionID)) continue
    stale.push(sessionID)
  }
  return stale
}

/**
 * 反向:挑出「后端说忙、本地却不忙」的会话 —— 这些要被恢复成 busy。
 *
 * FORK 2026-09-18 —— 对账必须是**双向**的。
 * [bug-repro: REQ-100 ① 的停止键兜底在 4s 后把 session_status 写成 idle,注释写「重连/周期对账会把
 *  真实状态盖回来」,但当时对账只有上面那个单向函数(busy→idle),`seedActiveSessionStatuses` 又
 *  显式跳过**已定义**的键(`if (... !== undefined) continue`),后端也只在状态**跃迁**时推事件 ——
 *  三条路都不会把 busy 写回来。于是后端还在跑(interrupt 响应 >4s)时前端已自认 idle,
 *  `session.tsx` 的 `queueEnabled` 读同一个 store 判为不忙 → 用户下一条消息**绕过队列直接 prompt**,
 *  与仍在运行的那一轮并发。]
 *
 * 两条不恢复的情形:
 *   ① 本地已经是 busy —— 没什么可恢复
 *   ② 有未确认的乐观消息 —— 与上面同一道竞态护栏,该会话状态正在飞,别插手
 */
export function collectMissingBusySessions(input: StaleBusyInput): string[] {
  const missing: string[] = []
  for (const [sessionID, isBusy] of Object.entries(input.remote)) {
    if (!isBusy) continue
    if (input.local[sessionID]?.type === "busy") continue
    if (input.pending(sessionID)) continue
    missing.push(sessionID)
  }
  return missing
}
