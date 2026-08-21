// [fork-only] REQ-102 语音派活 — 任务轮询/刷新触发单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 2-plan「会话列表不刷新」:语音宿主与主实例共享 db 但不共享 event bus,只能自己补通知。
import { describe, expect, test } from "bun:test"
import { shouldRefresh, startTaskWatch, taskSignature } from "./task-watch"

const tasks = (...items: Array<[string, string]>) => ({
  tasks: items.map(([id, workState]) => ({ id, workId: id, workState, progress: Math.random() })),
})

describe("taskSignature", () => {
  // 只认「有哪些任务 + 各自状态」;progress 之类每秒都在抖,拿它当指纹会让界面一直闪
  test("同一批任务的指纹稳定,与进度抖动无关", () => {
    expect(taskSignature(tasks(["a", "running"]))).toBe(taskSignature(tasks(["a", "running"])))
  })

  test("状态变了 / 多了任务 → 指纹变", () => {
    expect(taskSignature(tasks(["a", "running"]))).not.toBe(taskSignature(tasks(["a", "completed"])))
    expect(taskSignature(tasks(["a", "running"]))).not.toBe(taskSignature(tasks(["a", "running"], ["b", "running"])))
  })

  test("顺序不影响指纹(接口返回顺序不保证)", () => {
    expect(taskSignature(tasks(["a", "running"], ["b", "done"]))).toBe(taskSignature(tasks(["b", "done"], ["a", "running"])))
  })

  test("畸形输入 → 空串,不抛", () => {
    expect(taskSignature(null)).toBe("")
    expect(taskSignature({})).toBe("")
    expect(taskSignature({ tasks: "nope" })).toBe("")
  })
})

describe("shouldRefresh", () => {
  // 刚起网关时会一次性读到历史任务,那批不是"刚发生的事" —— 拿它触发刷新等于每次开语音都抖一下
  test("首次快照不算变化", () => {
    expect(shouldRefresh(null, "a:running")).toBe(false)
  })

  test("变了才刷,没变不刷", () => {
    expect(shouldRefresh("a:running", "a:completed")).toBe(true)
    expect(shouldRefresh("a:running", "a:running")).toBe(false)
  })
})

describe("startTaskWatch", () => {
  const harness = () => {
    let fn: (() => void) | null = null
    const notified: number[] = []
    return {
      tickOnce: () => fn?.(),
      notified,
      opts: (fetchTasks: () => Promise<unknown>) => ({
        fetchTasks,
        notify: () => notified.push(1),
        setInterval: (f: () => void) => {
          fn = f
          return 1 as unknown
        },
        clearInterval: () => {
          fn = null
        },
      }),
    }
  }

  test("基线建立后,变化才通知", async () => {
    const h = harness()
    let payload: unknown = tasks(["a", "running"])
    startTaskWatch(h.opts(async () => payload))
    await Promise.resolve()
    await Promise.resolve()
    expect(h.notified.length).toBe(0) // 首次只建基线

    payload = tasks(["a", "completed"])
    h.tickOnce()
    await Promise.resolve()
    await Promise.resolve()
    expect(h.notified.length).toBe(1)

    h.tickOnce() // 没再变
    await Promise.resolve()
    await Promise.resolve()
    expect(h.notified.length).toBe(1)
  })

  // 网关正在起 / 正在停的时候抓取必然失败,不能因此打断轮询,更不能把基线冲掉
  test("抓取失败静默跳过,不通知也不破坏基线", async () => {
    const h = harness()
    let fail = false
    let payload: unknown = tasks(["a", "running"])
    startTaskWatch(
      h.opts(async () => {
        if (fail) throw new Error("ECONNREFUSED")
        return payload
      }),
    )
    await Promise.resolve()
    await Promise.resolve()

    fail = true
    h.tickOnce()
    await Promise.resolve()
    await Promise.resolve()
    expect(h.notified.length).toBe(0)

    fail = false
    payload = tasks(["a", "completed"])
    h.tickOnce()
    await Promise.resolve()
    await Promise.resolve()
    expect(h.notified.length).toBe(1) // 基线仍是失败前那个,变化照样认得出
  })

  test("stop 之后不再通知(停网关时的在飞请求不该再打扰界面)", async () => {
    const h = harness()
    let payload: unknown = tasks(["a", "running"])
    const handle = startTaskWatch(h.opts(async () => payload))
    await Promise.resolve()
    await Promise.resolve()

    payload = tasks(["a", "completed"])
    handle.stop()
    h.tickOnce()
    await Promise.resolve()
    await Promise.resolve()
    expect(h.notified.length).toBe(0)
  })
})
