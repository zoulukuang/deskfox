// [bug-repro: 后端 respawn 后被 evict 的目录拿不到对账,其名下会话的残留 busy 永不清除 —— 真机实测
//              UI 卡"思考中" ≥38 分钟、横跨一次完整的后端 respawn + 前端重连仍未复位]
// REQ-100 ②③ · 2026-09-17 · [feat: release-closeout-2026-09]
//
// 🔴 2026-09-18 发版前 code-review 抓出:首版是**更糟的回归** —— 拿 A 目录的 status 表去清
//    B 目录的 busy,把别的项目里正在生成的会话打成 idle。补 directoryOf + coveredDirectories 两道守卫。
//    首版之所以敢丢守卫,是因为误信「后端 SessionStatus 是全局表」;实际它建在 InstanceState 上、
//    按 directory 分桶(instance-state.ts:47 `ScopedCache.get(cache, yield* directory)`)。
//    **当时 100+ 条测试全绿也没拦住,因为一条多目录用例都没有。** 本文件补齐该族。

import { describe, expect, test } from "bun:test"
import { collectMissingBusySessions, collectStaleBusySessions, type StaleBusyInput } from "./stale-busy"

const never = () => false
const DIR_A = "/proj/a"
const DIR_B = "/proj/b"

/** 默认场景:单目录 A、已查成功、会话都在 A 下 */
function args(over: Partial<StaleBusyInput> = {}): StaleBusyInput {
  return {
    local: {},
    remote: {},
    pending: never,
    directoryOf: () => DIR_A,
    coveredDirectories: new Set([DIR_A]),
    ...over,
  }
}

describe("collectStaleBusySessions —— 清残留(busy → idle)", () => {
  test("本地 busy + 后端表里没有 → 判为残留,要清", () => {
    expect(collectStaleBusySessions(args({ local: { ses_a: { type: "busy" } } }))).toEqual(["ses_a"])
  })

  test("后端也说忙 → 不清(人家真在跑)", () => {
    expect(
      collectStaleBusySessions(args({ local: { ses_a: { type: "busy" } }, remote: { ses_a: true } })),
    ).toEqual([])
  })

  test("本地不是 busy → 不动(idle / undefined 都不碰)", () => {
    expect(collectStaleBusySessions(args({ local: { ses_a: { type: "idle" }, ses_b: undefined } }))).toEqual([])
  })

  test("竞态护栏:有未确认的乐观消息 → 不清(这一发还在飞)", () => {
    expect(
      collectStaleBusySessions(args({ local: { ses_a: { type: "busy" } }, pending: (id) => id === "ses_a" })),
    ).toEqual([])
  })

  test("不按 child store 切 —— 被 evict 目录名下的会话同样被对账到(REQ-100 原始复现)", () => {
    const local: Record<string, { type: string }> = { ses_stuck: { type: "busy" } }
    for (let i = 0; i < 6; i++) local[`ses_active_${i}`] = { type: "idle" }
    expect(collectStaleBusySessions(args({ local }))).toEqual(["ses_stuck"])
  })

  test("多个残留一次全清", () => {
    expect(
      collectStaleBusySessions(
        args({
          local: { a: { type: "busy" }, b: { type: "busy" }, c: { type: "busy" } },
          remote: { b: true },
          pending: (id) => id === "c",
        }),
      ),
    ).toEqual(["a"])
  })

  test("空表不炸", () => {
    expect(collectStaleBusySessions(args())).toEqual([])
  })

  // ===== 🔴 目录作用域:首版栽在这一族,当时一条用例都没有 =====

  test("🔴 别的目录里正在跑的会话,不得被本目录的表清掉", () => {
    // 场景:用户同时开 A(服务端默认目录)和 B,B 的会话正在生成。
    // 本轮只查到了 A 的表 → B 的会话在 remote 里缺席 —— 但那是「没查过」,不是「不忙」。
    expect(
      collectStaleBusySessions(
        args({
          local: { ses_in_b: { type: "busy" } },
          remote: {},
          directoryOf: () => DIR_B,
          coveredDirectories: new Set([DIR_A]),
        }),
      ),
    ).toEqual([])
  })

  test("🔴 查过的目录才清:A 查过→清,B 没查过→留", () => {
    expect(
      collectStaleBusySessions(
        args({
          local: { ses_a: { type: "busy" }, ses_b: { type: "busy" } },
          remote: {},
          directoryOf: (id) => (id === "ses_a" ? DIR_A : DIR_B),
          coveredDirectories: new Set([DIR_A]),
        }),
      ),
    ).toEqual(["ses_a"])
  })

  test("🔴 查不出所属目录 → 一律不动(fail-safe:宁可留着转圈也不误清)", () => {
    expect(
      collectStaleBusySessions(args({ local: { ses_x: { type: "busy" } }, directoryOf: () => undefined })),
    ).toEqual([])
  })

  test("🔴 目录查询失败(未进 covered)→ 该目录整体不清", () => {
    expect(
      collectStaleBusySessions(args({ local: { ses_a: { type: "busy" } }, coveredDirectories: new Set<string>() })),
    ).toEqual([])
  })

  test("🔴 两个目录都查过 → 两边的残留都清", () => {
    expect(
      collectStaleBusySessions(
        args({
          local: { ses_a: { type: "busy" }, ses_b: { type: "busy" } },
          directoryOf: (id) => (id === "ses_a" ? DIR_A : DIR_B),
          coveredDirectories: new Set([DIR_A, DIR_B]),
        }),
      ).sort(),
    ).toEqual(["ses_a", "ses_b"])
  })
})

// [bug-repro: REQ-100 ① 的停止键兜底在 4s 后把 session_status 写成 idle,注释写「对账会把真实状态盖回来」,
//  对账当时只有 busy→idle 单向,seedActiveSessionStatuses 显式跳过已定义的键,
//  后端又只在状态跃迁时推事件。后果是后端还在跑(interrupt 响应 >4s)、前端已自认 idle,
//  queueEnabled 随之为假 → 用户下一条消息绕过队列,与仍在运行的那轮并发。]
describe("collectMissingBusySessions —— 后端忙但本地不忙,要补回 busy", () => {
  test("兜底写成 idle 后,对账把真实 busy 恢复回来(本缺陷的正面复现)", () => {
    expect(
      collectMissingBusySessions(args({ local: { ses_stopped: { type: "idle" } }, remote: { ses_stopped: true } })),
    ).toEqual(["ses_stopped"])
  })

  test("本地缺席、后端说忙 → 也要补(seed 只填缺失,但它跑在别处)", () => {
    expect(collectMissingBusySessions(args({ remote: { a: true } }))).toEqual(["a"])
  })

  test("本地已 busy → 不重复写", () => {
    expect(collectMissingBusySessions(args({ local: { a: { type: "busy" } }, remote: { a: true } }))).toEqual([])
  })

  test("后端说不忙 → 不补(不忙就是不忙)", () => {
    expect(collectMissingBusySessions(args({ local: { a: { type: "idle" } }, remote: { a: false } }))).toEqual([])
  })

  test("有未确认乐观消息 → 同一道竞态护栏,不插手", () => {
    expect(
      collectMissingBusySessions(
        args({ local: { a: { type: "idle" } }, remote: { a: true }, pending: (id) => id === "a" }),
      ),
    ).toEqual([])
  })

  test("两个方向互不干扰:同一批里该清的清、该补的补", () => {
    const input = args({
      local: { stale: { type: "busy" }, stopped: { type: "idle" } },
      remote: { stopped: true },
    })
    expect(collectStaleBusySessions(input)).toEqual(["stale"])
    expect(collectMissingBusySessions(input)).toEqual(["stopped"])
  })

  test("空表不炸", () => {
    expect(collectMissingBusySessions(args())).toEqual([])
  })

  test("🔴 反向不需要目录守卫 —— remote 条目本就只来自查成功的目录,是正面证据", () => {
    // 「后端说它忙」是正面证据,不像「后端没说它忙」那样存在「没查过」的歧义。
    // 所以即便 coveredDirectories 为空、directoryOf 未知,也照补不误。
    expect(
      collectMissingBusySessions(
        args({
          local: { ses_a: { type: "idle" } },
          remote: { ses_a: true },
          directoryOf: () => undefined,
          coveredDirectories: new Set<string>(),
        }),
      ),
    ).toEqual(["ses_a"])
  })

  test("🔴 没有会话会同时落进两个方向(否则每轮对账都来回翻转)", () => {
    const input = args({
      local: { a: { type: "busy" }, b: { type: "idle" }, c: { type: "busy" } },
      remote: { b: true, c: true },
    })
    const stale = new Set(collectStaleBusySessions(input))
    for (const id of collectMissingBusySessions(input)) expect(stale.has(id)).toBe(false)
  })
})
