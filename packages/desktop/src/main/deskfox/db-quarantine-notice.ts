// [fork-only] REQ-084① 数据库隔离通知的暂存 [feat: voice-preclear-batch] 2026-08-18
//
// 为什么需要暂存:检测发生在启动最早期(sidecar 之前,窗口还没建),而 toast 要等 renderer 起来才能显示。
// 这里存一份「一次性通知」,renderer 就绪后经 IPC(deskfox:get_db_quarantine_notice)取走并清空 ——
// 取过就不再重复弹,重启后若问题已解决自然也不会再有。

export interface DbQuarantineNotice {
  /** migrate = 迁移期超前 db 未迁入;startup = 启动期已把 ns 内超前 db 挪走。 */
  kind: "migrate" | "startup"
  /** 涉及的 db 文件名。 */
  dbNames: string[]
  /** 相关文件所在目录(告诉用户去哪找回)。 */
  dir?: string
}

let pending: DbQuarantineNotice | undefined

export function setDbQuarantineNotice(notice: DbQuarantineNotice): void {
  // 启动期(已实际挪档)优先级高于迁移期,不被后者覆盖。
  if (pending?.kind === "startup" && notice.kind === "migrate") return
  pending = notice
}

/** 取走并清空(一次性)。renderer 端消费。 */
export function takeDbQuarantineNotice(): DbQuarantineNotice | null {
  const n = pending
  pending = undefined
  return n ?? null
}

/** 仅测试用:重置暂存。 */
export function __resetDbQuarantineNotice(): void {
  pending = undefined
}
