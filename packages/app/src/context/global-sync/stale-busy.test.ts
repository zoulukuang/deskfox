// [bug-repro: 后端 respawn 后被 evict 的目录拿不到对账,其名下会话的残留 busy 永不清除 —— 真机实测
//              UI 卡"思考中" ≥38 分钟、横跨一次完整的后端 respawn + 前端重连仍未复位]
// REQ-100 ②③ · 2026-09-17 · [feat: release-closeout-2026-09]

import { describe, expect, test } from "bun:test"
import { collectStaleBusySessions } from "./stale-busy"

const never = () => false

describe("collectStaleBusySessions", () => {
  test("本地 busy + 后端表里没有 → 判为残留,要清", () => {
    expect(
      collectStaleBusySessions({
        local: { ses_a: { type: "busy" } },
        remote: {},
        pending: never,
      }),
    ).toEqual(["ses_a"])
  })

  test("后端也说忙 → 不清(人家真在跑)", () => {
    expect(
      collectStaleBusySessions({
        local: { ses_a: { type: "busy" } },
        remote: { ses_a: true },
        pending: never,
      }),
    ).toEqual([])
  })

  test("后端明确说不忙 → 清", () => {
    expect(
      collectStaleBusySessions({
        local: { ses_a: { type: "busy" } },
        remote: { ses_a: false },
        pending: never,
      }),
    ).toEqual(["ses_a"])
  })

  test("本地不是 busy → 不动(idle / undefined 都不碰)", () => {
    expect(
      collectStaleBusySessions({
        local: { ses_a: { type: "idle" }, ses_b: undefined },
        remote: {},
        pending: never,
      }),
    ).toEqual([])
  })

  test("竞态护栏:有未确认的乐观消息 → 不清(这一发还在飞)", () => {
    expect(
      collectStaleBusySessions({
        local: { ses_a: { type: "busy" } },
        remote: {},
        pending: (id) => id === "ses_a",
      }),
    ).toEqual([])
  })

  test("不按目录切 —— 被 evict 目录名下的会话同样被对账到(本条就是 REQ-100 的复现)", () => {
    // 模拟真机现场:6 个活跃目录的会话都正常,出事的那个目录已被 evict,
    // 但它名下的 ses_stuck 仍留着残留 busy。旧实现按目录遍历 + active 闸 → 永远跳过它。
    const local: Record<string, { type: string }> = { ses_stuck: { type: "busy" } }
    for (let i = 0; i < 6; i++) local[`ses_active_${i}`] = { type: "idle" }

    expect(
      collectStaleBusySessions({ local, remote: {}, pending: never }),
    ).toEqual(["ses_stuck"])
  })

  test("多个残留一次全清", () => {
    const result = collectStaleBusySessions({
      local: { a: { type: "busy" }, b: { type: "busy" }, c: { type: "busy" } },
      remote: { b: true },
      pending: (id) => id === "c",
    })
    expect(result).toEqual(["a"])
  })

  test("空表不炸", () => {
    expect(collectStaleBusySessions({ local: {}, remote: {}, pending: never })).toEqual([])
  })
})
