// 结构闸 —— 周期对账的**协议分流**不得再被删掉。
//
// [bug-repro: 2026-09-18 第二轮修复在给对账加目录作用域时,把原有的 v1/v2 分流一并删了,
//  无条件走 `sdkFor(directory).session.status()`。而 sdkFor → serverSDK.createClient 造的是
//  legacy v1 client,于是 v2 连接下每个目录都抛错、被 `catch {}` 吞掉 → covered 恒空 →
//  正反两个方向全部空转,REQ-100 在 v2 上完全失效,还每 60 秒对每个目录打一轮必失败的 HTTP。
//  当时那句注释「与 bootstrap.ts 同一写法,两种协议通用」是错的 —— bootstrap 紧挨着那行的
//  上一行正是 `if ((await input.protocol) !== "v1") return`,它本身就只在 v1 下执行。]
//
// 为什么是结构闸:reconcileSessionStatuses 是 createServerSync 闭包里的内部函数,吃满
// serverSDK / children / session store,搭行为 harness 得复刻一整套 context —— 那正是
// 「测试测的是逻辑副本而非真代码」的老陷阱。这里直接读真文件断言分流还在。
//
// 2026-09-18 第三轮 code-review · [feat: release-closeout-2026-09]

import { describe, expect, test } from "bun:test"

const SRC = await Bun.file(new URL("./server-sync.tsx", import.meta.url)).text()
const BOOTSTRAP = await Bun.file(new URL("./global-sync/bootstrap.ts", import.meta.url)).text()

const RECONCILE = (() => {
  const start = SRC.indexOf("const reconcileSessionStatuses = async")
  expect(start).toBeGreaterThan(-1)
  const end = SRC.indexOf("const reconcileSessionStatusesSafely", start)
  expect(end).toBeGreaterThan(start)
  return SRC.slice(start, end)
})()

/**
 * 只留代码行的视图。位置类断言必须跑在它上面 ——
 * 否则注释里出现的 `session.status()` 之类会被当成代码,断言就成了测注释顺序
 * (本文件与 branding 的 trap 闸都各踩过一次这个坑)。
 */
const CODE = RECONCILE.split("\n")
  .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
  .join("\n")

describe("周期对账 · 协议分流", () => {
  test("🔴 对账体内必须按 protocol 分流", () => {
    expect(CODE).toMatch(/protocol\)?\s*===\s*"v1"/)
  })

  test("🔴 v1 专属的 `session.status()` 只能出现在 v1 分支里", () => {
    const branch = CODE.indexOf('=== "v1"')
    const status = CODE.indexOf("session.status()")
    expect(branch).toBeGreaterThan(-1)
    expect(status).toBeGreaterThan(branch)
    // 且 v2 分支用的是 v2 自己的端点(它的生成签名里没有 directory 参数,按构造即服务器全局)
    expect(CODE).toContain("session.active()")
    expect(CODE.indexOf("session.active()")).toBeGreaterThan(status)
  })

  test("🔒 依据仍然成立 —— bootstrap 的同款调用确实带着 v1 守卫", () => {
    // 这条钉的是上面那个判断的**前提**。若上游哪天让 sdk.session.status() 两种协议通用,
    // 这里会先红,提示去复核对账是否还需要分流,而不是让错误结论继续躺在注释里。
    const i = BOOTSTRAP.indexOf("input.sdk.session.status()")
    expect(i).toBeGreaterThan(-1)
    const before = BOOTSTRAP.slice(Math.max(0, i - 400), i)
    expect(before).toContain('!== "v1"')
  })

  test("🔒 只有查成功的目录才进 covered —— 查失败不得被当成「不忙」", () => {
    const tryIdx = CODE.indexOf("try {")
    const covered = CODE.indexOf("covered.add(directory)")
    const cat = CODE.indexOf("} catch {")
    expect(tryIdx).toBeGreaterThan(-1)
    expect(covered).toBeGreaterThan(tryIdx)
    expect(covered).toBeLessThan(cat)
  })

  test("🔒 目录集合仍取并集 —— 两个方向各需要一半", () => {
    // ① 本地 busy 会话所属目录(busy→idle 要,含被 evict 的)
    expect(RECONCILE).toContain("session.get(sessionID)?.directory")
    // ② 已打开的目录(idle→busy 要,那些目录本地没有任何 busy)
    expect(RECONCILE).toContain("Object.keys(children.children)")
  })
})

// FORK 2026-09-19 第四轮 code-review —— 两段式反向对账的结构闸。
// [bug-repro: 反向对账要求 directoryOf 能定位,而 REQ-100 ① 那条链路(停止兜底写 idle →
//  LRU preserve 撤掉保护 → info 被挤掉)让它恒为 undefined,于是那一类会话永久补不回 busy,
//  用户下一条消息绕过队列与仍在跑的那轮并发。修法是补判定**之前**先 resolve 一次。]
//
// 同样是结构闸而非行为测:纯逻辑部分已在 global-sync/stale-busy.test.ts 覆盖
// (含「resolve 之后重跑就补得上」的两段式闭环),这里只钉调用侧的顺序不被再次拆掉。
describe("周期对账 · 反向补状态前的 resolve", () => {
  test("🔴 resolve 必须发生在 collectMissingBusySessions **之前**", () => {
    const unresolved = CODE.indexOf("collectUnresolvedBusySessions(")
    const resolve = CODE.indexOf("session.resolve(", unresolved)
    const missing = CODE.indexOf("collectMissingBusySessions(")
    expect(unresolved).toBeGreaterThan(-1)
    expect(resolve).toBeGreaterThan(unresolved)
    expect(missing).toBeGreaterThan(resolve)
  })

  test("🔴 必须 await —— 不然判定跑在 info 回来之前,等于没修", () => {
    const window = CODE.slice(CODE.indexOf("collectUnresolvedBusySessions("), CODE.indexOf("collectMissingBusySessions("))
    expect(window).toContain("await Promise.all(")
  })

  test("🔒 单个会话 resolve 失败不得掀翻整轮对账", () => {
    const window = CODE.slice(CODE.indexOf("collectUnresolvedBusySessions("), CODE.indexOf("collectMissingBusySessions("))
    expect(window).toMatch(/session\.resolve\([^)]*\)\.catch\(/)
  })
})
