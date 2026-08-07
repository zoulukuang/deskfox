// FORK-ONLY: REQ-099 托盘健康状态映射(纯逻辑) [feat: tray-health-status] 2026-08-07
//
// 看门狗(sidecar-watchdog.ts)已经在广播 sidecar 健康状态,但此前只发给 renderer 弹 toast
// (packages/app/src/utils/sidecar-health.ts);关窗到托盘后用户完全看不出后台是"在重启"
// 还是"已经放弃了"。这里把「状态 → 托盘文案 + 图标」收敛成可单测的纯函数,
// tray.ts 只做展示(与 sidecar-health.ts 的分工同形)。

/** 托盘图标三态。与 tray-icons.generated.ts 的 key 一一对应。 */
export type TrayIconKey = "ok" | "restarting" | "gave-up"

export type TrayStatusView = {
  label: string
  icon: TrayIconKey
}

/** 默认(就绪)。buildMenu 的初始文案与 ready 态必须一致,否则菜单初值与状态不同步。 */
export const TRAY_STATUS_READY: TrayStatusView = { label: "状态:就绪", icon: "ok" }

const VIEWS: Record<string, TrayStatusView> = {
  ready: TRAY_STATUS_READY,
  restarting: { label: "状态:后台服务重启中…", icon: "restarting" },
  "gave-up": { label: "状态:后台服务已停止,请重启 DeskFox", icon: "gave-up" },
}

/**
 * 看门狗状态 → 托盘视图;返回 undefined 表示"不改托盘"。
 *
 * ⚠️ 通道 "deskfox:sidecar-watchdog" 上还跑着 memory-brake 的 `memory-pressure`(index.ts),
 * 它语义是"压力预警"而非"服务不可用",不改托盘 → 走 undefined 分支(与 sidecar-health.ts
 * 里"无需弹 toast 则 undefined"的既有约定同形)。未知值同样返 undefined,不抛。
 */
export function mapWatchdogStatusToTray(status: unknown): TrayStatusView | undefined {
  if (typeof status !== "string") return undefined
  // hasOwn 而非直接索引:否则 "toString" / "constructor" 会命中 Object.prototype 上的成员
  return Object.hasOwn(VIEWS, status) ? VIEWS[status] : undefined
}
