// FORK-ONLY file: REQ-097 — ⌘K 内容命中 → 会话页查找条的一次性联动通道 [feat: in-session-find]

export type FindRequest = { sessionID: string; query: string; anchorID?: string }

let pending: FindRequest | undefined

export function setPendingFind(request: FindRequest): void {
  pending = request
}

export function consumePendingFind(sessionID: string | undefined): FindRequest | undefined {
  if (!sessionID || pending?.sessionID !== sessionID) return undefined
  const value = pending
  pending = undefined
  return value
}
