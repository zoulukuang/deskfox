// FORK-ONLY file: REQ-097 — ⌘K 内容命中 → 会话页查找条的一次性联动通道 [feat: in-session-find]
//
// ⚠️ 状态挂 globalThis 不用模块级变量:防 vite/rollup 小模块内联把本文件复制进多个 chunk
//   后模块单例退化成多份(chunk 拓扑不受我们控制,挂全局一劳永逸)。
// ⚠️ 纸条带时间戳 + TTL:垂死实例回投(见 find-bar onCleanup)可能把请求放回,TTL 保证
//   用户几秒后再进该会话不会被陈腐请求突然弹出查找条。

export type FindRequest = { sessionID: string; query: string; anchorID?: string }

type Stamped = { request: FindRequest; at: number }
type Slot = { pending: Stamped | undefined }

/** 回投的请求最多存活 10s,过期即弃 */
const TTL_MS = 10_000

const slot: Slot = ((globalThis as unknown as { __deskfoxPendingFind?: Slot }).__deskfoxPendingFind ??= {
  pending: undefined,
})

export function setPendingFind(request: FindRequest): void {
  slot.pending = { request, at: Date.now() }
}

export function consumePendingFind(sessionID: string | undefined): FindRequest | undefined {
  const stamped = slot.pending
  if (!sessionID || !stamped || stamped.request.sessionID !== sessionID) return undefined
  slot.pending = undefined
  if (Date.now() - stamped.at > TTL_MS) return undefined
  return stamped.request
}
