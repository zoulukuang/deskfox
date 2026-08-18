// FORK-ONLY: REQ-108 会话进度条纯逻辑 [feat: session-presentation-input-batch] 2026-08-17
//
// 2026-08-11 上游同步(1.17.4 → 1.18.16)把整块 DeskFox 定制冲掉:CSS 动效 / 设置字段 /
// 设置开关 / 渲染点四处全无。按基准版 e77443750e `pages/session/message-timeline.tsx` 搬回时,
// 把两段纯计算抽到本文件 —— 组件文件里测不动(SolidJS view),抽出来才进得了 Logic 清单。

/**
 * 扫动一个来回的时长(ms):随标题栏宽度线性缩放并夹在 1200~3200ms。
 * 窄窗不至于快到发抖、宽窗不至于慢到像卡住(基准版原值,不重新调参)。
 */
export function sessionProgressPace(width: number) {
  return Math.round(Math.max(1200, Math.min(3200, (Math.max(width, 360) * 2000) / 900)))
}

export type SessionProgressStatus = "hidden" | "showing" | "hiding"

/**
 * 三态推进:`hiding` 专供任务结束后的 220ms 淡出 —— 硬消失和淡出是两种手感,别省成布尔。
 * `timeoutDone=false` 表示淡出计时还没走完,期间即使已经 idle 也必须留在 hiding。
 */
export function nextSessionProgressStatus(input: {
  previous: SessionProgressStatus | undefined
  working: boolean
  timeoutDone: boolean
}): SessionProgressStatus {
  if (input.working) return "showing"
  if (input.previous === "showing" || !input.timeoutDone) return "hiding"
  return "hidden"
}
