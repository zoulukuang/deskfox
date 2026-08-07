// FORK-ONLY test: REQ-097 — ⌘K→查找条联动通道 [feat: in-session-find]
// bug-repro(2026-08-07 真机):同会话 hash 导航触发 timeline 重挂,垂死实例消费纸条后
// 连同刚开的查找条一起被卸载 → 联动断裂。修法 = 消费登记 + 垂死回投(find-bar onCleanup)
// + globalThis 单一存储 + TTL 防陈腐。本文件钉死存储契约与 TTL;回投行为真机 CDP 验证。
import { describe, expect, test } from "bun:test"
import { consumePendingFind, setPendingFind, type FindRequest } from "./find-request"

type Slot = { pending: { request: FindRequest; at: number } | undefined }
const globalSlot = () => (globalThis as unknown as { __deskfoxPendingFind?: Slot }).__deskfoxPendingFind

describe("find-request", () => {
  test("状态挂 globalThis(chunk 被复制时所有拷贝共享同一存储)", () => {
    setPendingFind({ sessionID: "ses_a", query: "南" })
    // 「另一份 chunk 里的拷贝」= 任何直接读 globalThis 槽位的代码,必须看得到写入
    expect(globalSlot()?.pending?.request.query).toBe("南")
    expect(consumePendingFind("ses_a")?.query).toBe("南")
    expect(globalSlot()?.pending).toBeUndefined()
  })

  test("一次性消费:第二次读返回 undefined", () => {
    setPendingFind({ sessionID: "ses_b", query: "q", anchorID: "msg_1" })
    expect(consumePendingFind("ses_b")).toEqual({ sessionID: "ses_b", query: "q", anchorID: "msg_1" })
    expect(consumePendingFind("ses_b")).toBeUndefined()
  })

  test("sessionID 不匹配不消费,pending 保留给正确会话", () => {
    setPendingFind({ sessionID: "ses_c", query: "q" })
    expect(consumePendingFind("ses_other")).toBeUndefined()
    expect(consumePendingFind(undefined)).toBeUndefined()
    expect(consumePendingFind("ses_c")?.query).toBe("q")
  })

  test("回投再消费(垂死实例 → 新实例接力)", () => {
    setPendingFind({ sessionID: "ses_d", query: "q", anchorID: "msg_2" })
    const consumed = consumePendingFind("ses_d")
    expect(consumed).toBeDefined()
    // 垂死实例 onCleanup 回投
    setPendingFind(consumed!)
    expect(consumePendingFind("ses_d")).toEqual({ sessionID: "ses_d", query: "q", anchorID: "msg_2" })
  })

  test("超过 TTL 的纸条消费时作废(防陈腐弹条)", () => {
    setPendingFind({ sessionID: "ses_e", query: "q" })
    const slot = globalSlot()!
    slot.pending = { ...slot.pending!, at: Date.now() - 11_000 } // 伪造 11s 前写入
    expect(consumePendingFind("ses_e")).toBeUndefined()
    expect(slot.pending).toBeUndefined() // 过期即清,不残留
  })
})
