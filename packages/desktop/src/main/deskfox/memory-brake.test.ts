// FORK-ONLY: REQ-049 内存软刹车单测 [feat: sidecar-oom-brake] 2026-08-02
import { describe, expect, test } from "bun:test"
import {
  createMemoryPressureMonitor,
  PRESSURE_RATIO,
  REMIND_INTERVAL_MS,
  type HeapSample,
  type MemoryPressureEvent,
} from "./memory-brake"

const GB = 1024 * 1024 * 1024

function harness(initial: HeapSample) {
  let sample = initial
  let now = 0
  const events: MemoryPressureEvent[] = []
  const monitor = createMemoryPressureMonitor({
    sample: () => sample,
    emit: (event) => events.push(event),
    now: () => now,
  })
  return {
    events,
    monitor,
    set: (next: Partial<HeapSample>) => (sample = { ...sample, ...next }),
    tick: (ms: number) => (now += ms),
  }
}

describe("memory pressure monitor", () => {
  test("crossing the pressure ratio emits once, then stays silent within remind interval", () => {
    const h = harness({ usedBytes: 1 * GB, limitBytes: 3 * GB })
    h.monitor.check()
    expect(h.events).toHaveLength(0)

    h.set({ usedBytes: 2.5 * GB }) // ratio ≈ 0.83 ≥ 0.8
    h.monitor.check()
    expect(h.events).toHaveLength(1)
    expect(h.events[0]?.limitMB).toBe(3072)
    expect(h.events[0]?.ratio).toBeGreaterThanOrEqual(PRESSURE_RATIO)

    h.tick(1_000)
    h.monitor.check() // 持续高压但在静默窗口内
    expect(h.events).toHaveLength(1)
  })

  test("sustained pressure re-reminds after the interval", () => {
    const h = harness({ usedBytes: 2.5 * GB, limitBytes: 3 * GB })
    h.monitor.check()
    h.tick(REMIND_INTERVAL_MS + 1)
    h.monitor.check()
    expect(h.events).toHaveLength(2)
  })

  test("dropping below rearm ratio re-arms immediate warning", () => {
    const h = harness({ usedBytes: 2.5 * GB, limitBytes: 3 * GB })
    h.monitor.check()
    expect(h.events).toHaveLength(1)

    h.set({ usedBytes: 1 * GB }) // ratio ≈ 0.33 < 0.7 → 重新武装
    h.monitor.check()
    h.tick(1_000)
    h.set({ usedBytes: 2.6 * GB })
    h.monitor.check() // 静默窗口未过,但已重新武装 → 立即报
    expect(h.events).toHaveLength(2)
  })

  test("zero limit is a no-op (defensive)", () => {
    const h = harness({ usedBytes: 1 * GB, limitBytes: 0 })
    h.monitor.check()
    expect(h.events).toHaveLength(0)
  })
})
