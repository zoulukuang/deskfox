// [fork-only] sidecar 看门狗熔断逻辑单测 — 从 Tauri server.rs over_restart_budget 平移
//   [feat: sidecar-watchdog-respawn / electron-replatform] 2026-06-13
import { describe, expect, test } from "bun:test"
import { createSidecarWatchdog, overRestartBudget, waitForSidecarHealth } from "./sidecar-watchdog"

const WINDOW = 120_000
const MAX = 5

describe("waitForSidecarHealth", () => {
  test("a healthy replacement completes recovery", async () => {
    await expect(waitForSidecarHealth(Promise.resolve(), 10)).resolves.toBeUndefined()
  })

  test("a failed replacement preserves its error", async () => {
    const error = new Error("replacement exited")
    await expect(waitForSidecarHealth(Promise.reject(error), 10)).rejects.toBe(error)
  })

  test("a replacement that never becomes healthy cannot report recovery", async () => {
    await expect(waitForSidecarHealth(new Promise<void>(() => {}), 10)).rejects.toThrow(
      "Sidecar did not become healthy within 10ms",
    )
  })
})

test("recovery timeout never emits ready; a later successful probe restores ready", async () => {
  const statuses: string[] = []
  const failed = Promise.withResolvers<void>()
  const recovered = Promise.withResolvers<void>()
  let healthy = false
  const watchdog = createSidecarWatchdog({
    pollIntervalMs: 1,
    startupGraceMs: 1,
    checkHealth: async () => healthy,
    isShuttingDown: () => false,
    respawn: () => waitForSidecarHealth(new Promise<void>(() => {}), 1),
    emit: (status) => {
      statuses.push(status)
      if (status === "ready") recovered.resolve()
    },
    log: (message) => {
      if (message === "sidecar watchdog: respawn failed") failed.resolve()
    },
  })
  watchdog.start()
  try {
    await failed.promise
    expect(statuses).toEqual(["restarting"])
    healthy = true
    await recovered.promise
    expect(statuses).toEqual(["restarting", "ready"])
  } finally {
    watchdog.stop()
  }
})

describe("overRestartBudget", () => {
  test("窗口内不足上限 → 不熔断", () => {
    const now = 1_000_000
    const restarts = [now - 1000, now - 2000, now - 3000, now - 4000] // 4 次
    expect(overRestartBudget(restarts, now, WINDOW, MAX)).toBe(false)
  })

  test("窗口内达上限 → 熔断", () => {
    const now = 1_000_000
    const restarts = [now - 1000, now - 2000, now - 3000, now - 4000, now - 5000] // 5 次
    expect(overRestartBudget(restarts, now, WINDOW, MAX)).toBe(true)
  })

  test("旧重启滑出窗口 → 不计入,不熔断", () => {
    const now = 1_000_000
    // 5 次但其中 3 次已超 120s 窗口
    const restarts = [now - 200_000, now - 150_000, now - 130_000, now - 1000, now - 2000]
    expect(overRestartBudget(restarts, now, WINDOW, MAX)).toBe(false)
  })

  test("空历史 → 不熔断", () => {
    expect(overRestartBudget([], 1000, WINDOW, MAX)).toBe(false)
  })
})
