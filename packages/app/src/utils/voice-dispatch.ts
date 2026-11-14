// FORK-ONLY: REQ-102 语音派活入口的判定逻辑(纯函数) [feat: voice-dispatch-minimal] 2026-08-21
// 组件只做渲染;这里的判定进 Logic 清单候选,单测覆盖。

export type VoiceState = "unavailable" | "off" | "starting" | "on" | "error"

export interface VoiceStatus {
  readonly state: VoiceState
  readonly detail: string
  readonly gatewayUrl?: string
}

/** 点下去该干什么。`none` = 按钮禁用(点了没反应是最差的表现,所以要显式表达)。 */
export function nextAction(status: VoiceStatus): "start" | "stop" | "none" {
  switch (status.state) {
    case "off":
      return "start"
    case "on":
      return "stop"
    case "error":
      // 出过错允许再试一次 —— 常见成因(网关超时 / 目录不对)重试或换目录就好了
      return "start"
    default:
      return "none"
  }
}

/** 起停过程中,防连点起出两个 Gateway。 */
export function isBusy(status: VoiceStatus): boolean {
  return status.state === "starting"
}

/** tooltip 文案的 i18n key;detail 由主进程给,附在下面一行。 */
export function tooltipKey(status: VoiceStatus): string {
  switch (status.state) {
    case "on":
      return "titlebar.voice.on"
    case "starting":
      return "titlebar.voice.starting"
    case "unavailable":
      return "titlebar.voice.unavailable"
    case "error":
      return "titlebar.voice.error"
    default:
      return "titlebar.voice.off"
  }
}
