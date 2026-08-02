// FORK-ONLY: REQ-049 L3 单测 [feat: sidecar-oom-brake] 2026-08-02
import { describe, expect, test } from "bun:test"
import { INITIAL_SIDECAR_HEALTH_STATE, reduceSidecarHealth } from "./sidecar-health"

describe("reduceSidecarHealth", () => {
  test("restarting warns and marks state; following ready reports recovery", () => {
    const step1 = reduceSidecarHealth(INITIAL_SIDECAR_HEALTH_STATE, { status: "restarting" })
    expect(step1.state.restarting).toBeTrue()
    expect(step1.toast?.variant).toBe("error")

    const step2 = reduceSidecarHealth(step1.state, { status: "ready" })
    expect(step2.state.restarting).toBeFalse()
    expect(step2.toast?.variant).toBe("success")
  })

  test("ready without prior restarting stays silent", () => {
    const result = reduceSidecarHealth(INITIAL_SIDECAR_HEALTH_STATE, { status: "ready" })
    expect(result.toast).toBeUndefined()
  })

  test("gave-up always raises an error toast", () => {
    const result = reduceSidecarHealth({ restarting: true }, { status: "gave-up" })
    expect(result.toast?.variant).toBe("error")
    expect(result.state.restarting).toBeFalse()
  })

  test("memory pressure includes usage detail and keeps state", () => {
    const state = { restarting: true }
    const result = reduceSidecarHealth(state, { status: "memory-pressure", usedMB: 2500, limitMB: 3072 })
    expect(result.state).toBe(state)
    expect(result.toast?.title).toContain("2500MB / 3072MB")
  })

  test("unknown status is a no-op", () => {
    const result = reduceSidecarHealth(INITIAL_SIDECAR_HEALTH_STATE, {
      status: "???" as unknown as "ready",
    })
    expect(result.toast).toBeUndefined()
  })
})
