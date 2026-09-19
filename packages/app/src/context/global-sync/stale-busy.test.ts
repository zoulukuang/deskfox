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
import {
  collectMissingBusySessions,
  collectStaleBusySessions,
  collectUnresolvedBusySessions,
  type StaleBusyInput,
} from "./stale-busy"

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

  // [bug-repro: 反向对账给**前端根本不认识**的会话(CLI 起的 / 子 agent 的 / 尚未加载 info 的)写 busy,
  //  而正向清理的第一道守卫就是 `if (!directory) continue` —— 同一个会话正向永远够不着它。
  //  后端转 idle 后这条 busy 再也清不掉,且因非 idle 被 server-session.ts:277 的 LRU `preserve`
  //  永久钉住。即反向方向能**自造出** REQ-100 要消灭的那种幻影 busy。]
  test("🔴 查不出所属目录的会话不补 —— 否则造出正向永远清不掉的幻影 busy", () => {
    expect(
      collectMissingBusySessions(
        args({
          local: { ses_a: { type: "idle" } },
          remote: { ses_a: true },
          directoryOf: () => undefined,
        }),
      ),
    ).toEqual([])
  })

  test("🔴 补进来的会话下一轮正向必须够得着 —— 两个方向的可达性必须对称", () => {
    // 反证式断言:凡是反向补过的,后端转 idle 后正向都必须能把它清掉。
    const base = args({
      local: { ses_a: { type: "idle" }, ses_b: { type: "idle" } },
      remote: { ses_a: true, ses_b: true },
    })
    const directoryOf = (id: string) => (id === "ses_a" ? DIR_A : undefined)
    const missing = collectMissingBusySessions({ ...base, directoryOf })
    expect(missing).toEqual(["ses_a"])
    // 模拟下一轮:补过的都置 busy,后端已转 idle(remote 空)
    const local = Object.fromEntries(missing.map((id) => [id, { type: "busy" as const }]))
    const stale = collectStaleBusySessions({ ...base, local, remote: {}, directoryOf })
    expect(stale.sort()).toEqual([...missing].sort())
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

// [bug-repro: SessionStatus 是三态(idle / retry / busy),`retry` 带 attempt/message/action/next 负载,
//  被 session-retry.tsx(倒计时横幅)、usage-exceeded-dialogs.tsx(配额超限升级 CTA)、
//  timeline/rows.ts(时间线 retry 行)消费。collectMissingBusySessions 首版只跳过 `type === "busy"`,
//  于是本地 retry + 后端非 idle 时它进 missing,server-sync.tsx 用 `{type:"busy"}` **整体覆盖** →
//  横幅 / 弹窗 / retry 行全部消失,退化成普通转圈。retry 退避常是几分钟而对账 60 秒一轮,几乎必中。
//  此前 100+ 条测试全绿没拦住:一条 retry 用例都没有。
//  注:`seedActiveSessionStatuses` 早有同款不变量(server-sync.test.ts 的
//  「does not overwrite statuses already written by events」),反向对账绕过了它。]
describe("collectMissingBusySessions —— 不得碾掉 retry 等非 idle 的富状态", () => {
  test("🔴 本地 retry + 后端非 idle → 不补(补了就把 attempt/action 负载抹掉)", () => {
    expect(collectMissingBusySessions(args({ local: { ses_a: { type: "retry" } }, remote: { ses_a: true } }))).toEqual(
      [],
    )
  })

  test("🔴 判据是「本地已非 idle」而非「本地已 busy」—— 将来新增状态自动受保护", () => {
    // 钉死语义而不是枚举当前三态:再加第四态时不必回来改这里,也不会重演本次。
    for (const type of ["busy", "retry", "queued", "paused"]) {
      expect(collectMissingBusySessions(args({ local: { s: { type } }, remote: { s: true } }))).toEqual([])
    }
  })

  test("本地 idle / 缺席 → 仍然要补(别把守卫收得连正事都不干了)", () => {
    expect(collectMissingBusySessions(args({ local: { a: { type: "idle" } }, remote: { a: true } }))).toEqual(["a"])
    expect(collectMissingBusySessions(args({ remote: { b: true } }))).toEqual(["b"])
  })
})

// FORK 2026-09-19 第四轮 code-review。
// [bug-repro: 反向对账的 `if (!directoryOf(id)) continue` 恰好把 REQ-100 ① 要救的那一类
//  永久关在门外,链条是闭合的 —— submit.ts 的停止兜底 4s 后把 session_status 写成 idle
//  → server-session.ts 的 LRU `preserve` 只钉住 `type !== "idle"` 的会话,它当场失去保护、
//  从 data.info 被挤掉 → session.get(id) 返回 undefined → directoryOf 恒为 undefined
//  → 反向对账永久跳过它;唯一会重新 resolve 的 loadActiveSessionsQuery 是
//  staleTime: Infinity + 三个 refetchOn* false,不会再跑第二次,后端半死也不推事件。
//  净效果:后端还在跑,前端永久自认 idle,queueEnabled 判为不忙 → 用户下一条消息绕过队列
//  与仍在运行的那一轮并发 —— 正是首版反向对账要消灭的形态。
//  修法不是删守卫(那会退回"补得进来、清不掉"的幻影 busy),而是让它可满足:
//  调用方先按 collectUnresolvedBusySessions 补一次 session.resolve(),再下判定。]
describe("collectUnresolvedBusySessions —— 反向对账的 resolve 前置名单", () => {
  const unknown = args({ remote: { ses_a: true }, directoryOf: () => undefined })

  test("🔴 后端说忙、本地查不出目录 → 必须进名单(否则这条会话永远等不到对账)", () => {
    expect(collectUnresolvedBusySessions(unknown)).toEqual(["ses_a"])
  })

  test("🔴 与 collectMissingBusySessions 严格互补 —— 同一 input 下两份名单无交集、且合起来不漏", () => {
    const input = args({
      local: { known: { type: "idle" }, unknown: { type: "idle" }, retrying: { type: "retry" } },
      remote: { known: true, unknown: true, retrying: true },
      directoryOf: (id) => (id === "unknown" ? undefined : DIR_A),
    })
    const missing = collectMissingBusySessions(input)
    const unresolved = collectUnresolvedBusySessions(input)
    expect(missing).toEqual(["known"])
    expect(unresolved).toEqual(["unknown"])
    // retry 两边都不要(富状态护栏);两份名单不得重叠。
    // 注(2026-09-19 review):「反向补进来的一定正向清得掉」这个对称性由本文件
    // 「🔴 补进来的会话下一轮正向必须够得着」那条守;此前还有一条只调 collectStaleBusySessions
    // 的同义反复用例(与文件开头第一条断言完全相同),删掉不损失任何覆盖。
    for (const id of unresolved) expect(missing).not.toContain(id)
  })

  test("resolve 之后重跑 → 这条会话终于补得上(两段式闭环)", () => {
    // 模拟调用方:先拿名单去 session.resolve(),info 回到本地后 directoryOf 开始有值。
    const resolved = new Set<string>()
    const input = args({
      local: { ses_a: { type: "idle" } },
      remote: { ses_a: true },
      directoryOf: (id) => (resolved.has(id) ? DIR_A : undefined),
    })
    expect(collectMissingBusySessions(input)).toEqual([])
    for (const id of collectUnresolvedBusySessions(input)) resolved.add(id)
    expect(collectMissingBusySessions(input)).toEqual(["ses_a"])
  })

  test("本地已非 idle / 有在飞的乐观消息 → 不进名单(与反向对账同一套护栏)", () => {
    expect(
      collectUnresolvedBusySessions(
        args({ local: { s: { type: "retry" } }, remote: { s: true }, directoryOf: () => undefined }),
      ),
    ).toEqual([])
    expect(
      collectUnresolvedBusySessions(
        args({ remote: { s: true }, pending: () => true, directoryOf: () => undefined }),
      ),
    ).toEqual([])
  })

  test("目录本来就查得到 → 不必 resolve,名单为空(别每轮都去打没必要的请求)", () => {
    expect(collectUnresolvedBusySessions(args({ remote: { ses_a: true } }))).toEqual([])
  })
})
