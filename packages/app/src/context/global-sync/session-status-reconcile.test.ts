import { describe, expect, test } from "bun:test"
import type { SessionStatus } from "@opencode-ai/sdk/v2/client"
import { createStore, reconcile, type SetStoreFunction } from "solid-js/store"
import type { State } from "./types"
import { applyReconciledSessionStatus, reconcileSessionStatus } from "./session-status-reconcile"

const busy = { type: "busy" } as SessionStatus
const idle = { type: "idle" } as SessionStatus
const retry = { type: "retry", attempt: 1, message: "rate limited", next: 2 } as SessionStatus

describe("reconcileSessionStatus", () => {
  // 复现:进程被硬杀 / 事件丢 / sidecar 看门狗重启后,前端残留一条 busy;后端
  // session.status() 已不再上报它(权威 = idle)。对账必须把这条残留 busy 清掉,
  // 否则主视图永久「思考中」+ 停止按钮卡死(2026-06-12 回归,2026-06-06 的
  // heal-interrupted 只补盖消息 time.completed,管不到 session_status)。
  test("clears stale busy the backend no longer reports (stuck-working repro)", () => {
    const current: Record<string, SessionStatus | undefined> = { ses_stuck: busy }
    const { next, cleared } = reconcileSessionStatus(current, {})
    expect(next.ses_stuck).toBeUndefined()
    expect(cleared).toEqual(["ses_stuck"])
  })

  test("preserves sessions the backend still reports busy/retry", () => {
    const { next, cleared } = reconcileSessionStatus(
      { ses_a: busy },
      { ses_a: busy, ses_b: retry },
    )
    expect(next.ses_a).toEqual(busy as never)
    expect(next.ses_b).toEqual(retry as never)
    expect(cleared).toEqual([])
  })

  test("drops idle entries from backend payload (only non-idle is authoritative)", () => {
    const { next } = reconcileSessionStatus({}, { ses_x: idle, ses_y: busy })
    expect(next.ses_x).toBeUndefined()
    expect(next.ses_y).toEqual(busy as never)
  })

  test("idle entries already in the cache are not counted as cleared busy", () => {
    const { next, cleared } = reconcileSessionStatus({ ses_idle: idle, ses_stuck: busy }, {})
    expect(Object.keys(next)).toEqual([])
    expect(cleared).toEqual(["ses_stuck"])
  })

  test("tolerates null/undefined backend payload", () => {
    expect(reconcileSessionStatus({ ses_stuck: busy }, null).next.ses_stuck).toBeUndefined()
    expect(reconcileSessionStatus({ ses_stuck: busy }, undefined).cleared).toEqual(["ses_stuck"])
  })
})

describe("session_status store reconciliation (root-cause guard)", () => {
  // 证明根因:SolidJS 裸 setStore(对象)是 merge,清不掉后端没再上报的残留 busy;
  // reconcile(merge:false) 整体替换才能清掉。bootstrap.ts 的 session.status() 对账
  // 必须走后者,否则重连/重 bootstrap 也无法自愈卡死。
  test("bare merge leaves stale busy; reconcile replacement clears it", () => {
    const [store, setStore] = createStore<{ session_status: Record<string, SessionStatus> }>({
      session_status: { ses_stuck: busy },
    })

    // 旧写法(bug):后端返回空 → 裸 merge → 残留 busy 仍在 → 永久卡死
    setStore("session_status", {} as never)
    expect(store.session_status.ses_stuck).toEqual(busy as never)

    // 修复写法:reconcile 整体替换 → 残留 busy 被清
    const { next } = reconcileSessionStatus(store.session_status, {})
    setStore("session_status", reconcile(next, { merge: false }))
    expect(store.session_status.ses_stuck).toBeUndefined()
  })

  // 端到端守门:跑 bootstrap 对账实际调用的那个函数(applyReconciledSessionStatus),
  // 模拟 sidecar 重启后 session.status() 返回空 → 残留 busy 必须被清、活跃 busy 必须保留。
  test("applyReconciledSessionStatus clears stale busy on a real store (bootstrap path)", () => {
    const [store, setStore] = createStore<{ session_status: Record<string, SessionStatus> }>({
      session_status: { ses_stuck: busy, ses_idle_noise: idle },
    })
    const write = setStore as unknown as SetStoreFunction<State>

    // sidecar 重启:后端权威结果为空(它已不知道任何 session busy)
    const cleared = applyReconciledSessionStatus(store as Pick<State, "session_status">, write, {})
    expect(store.session_status.ses_stuck).toBeUndefined()
    expect(cleared).toEqual(["ses_stuck"])

    // 健康场景:后端仍上报 ses_live busy → 保留,不误清
    applyReconciledSessionStatus(store as Pick<State, "session_status">, write, { ses_live: busy })
    expect(store.session_status.ses_live).toEqual(busy as never)
  })
})
