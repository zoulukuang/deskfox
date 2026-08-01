// FORK-ONLY: REQ-049 L1 sidecar 内存软刹车(采样判定纯逻辑) [feat: sidecar-oom-brake] 2026-08-02
//
// 背景:sidecar(utilityProcess in-process Node)无内存治理,heap 撑爆直接 abort()(utility.log
// 看门狗 respawn ×7 实证)。硬帽由 server.ts fork 时 execArgv --max-old-space-size 兜底(撑爆快速
// OOM → L2 看门狗秒级 respawn,不再拖垮整机);本模块是软刹车:heap 占用逼近上限时提前上报
// 主进程 → 转发 renderer 提示用户(拆分任务/重启),把「毫无预兆崩掉」变「有预警可自救」。
//
// 判定语义(可单测):
// - ratio ≥ PRESSURE_RATIO 触发上报;
// - 触发后进入静默,持续高压期间每 REMIND_INTERVAL_MS 至多再报一次(防刷屏);
// - ratio 回落 < REARM_RATIO 重新武装(下次越线立即报)。

export type HeapSample = { usedBytes: number; limitBytes: number }

export type MemoryPressureEvent = {
  type: "memory-pressure"
  usedMB: number
  limitMB: number
  ratio: number
}

export const PRESSURE_RATIO = 0.8
export const REARM_RATIO = 0.7
export const REMIND_INTERVAL_MS = 120_000

export function createMemoryPressureMonitor(opts: {
  sample: () => HeapSample
  emit: (event: MemoryPressureEvent) => void
  now?: () => number
}) {
  const now = opts.now ?? Date.now
  let armed = true
  let lastEmitAt = Number.NEGATIVE_INFINITY

  return {
    check() {
      const sample = opts.sample()
      if (!sample.limitBytes) return
      const ratio = sample.usedBytes / sample.limitBytes

      if (ratio < REARM_RATIO) {
        armed = true
        return
      }
      if (ratio < PRESSURE_RATIO) return

      const at = now()
      if (!armed && at - lastEmitAt < REMIND_INTERVAL_MS) return
      armed = false
      lastEmitAt = at
      opts.emit({
        type: "memory-pressure",
        usedMB: Math.round(sample.usedBytes / 1024 / 1024),
        limitMB: Math.round(sample.limitBytes / 1024 / 1024),
        ratio: Math.round(ratio * 100) / 100,
      })
    },
  }
}
