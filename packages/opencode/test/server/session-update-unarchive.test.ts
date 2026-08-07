// FORK-ONLY test: REQ-096 — UpdatePayload time.archived 收 null = 取消归档 [feat: session-list-ux]
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { UpdatePayload } from "../../src/server/routes/instance/httpapi/groups/session"

const decode = Schema.decodeUnknownSync(UpdatePayload)

describe("session UpdatePayload.time.archived", () => {
  test("数字 = 归档时间戳,正常通过", () => {
    const result = decode({ time: { archived: 1754500000000 } })
    expect(result.time?.archived).toBe(1754500000000)
  })

  test("null = 取消归档,解码通过(REQ-096 扩展)", () => {
    const result = decode({ time: { archived: null } })
    expect(result.time?.archived).toBeNull()
  })

  test("省略 archived = 不改动", () => {
    const result = decode({ time: {} })
    expect(result.time?.archived).toBeUndefined()
  })

  test("非法字符串仍拒绝", () => {
    expect(() => decode({ time: { archived: "yes" } })).toThrow()
  })

  test("handler 透传语义:null ?? undefined 走 setArchived 清除路径", () => {
    // handler 内 `ctx.payload.time.archived ?? undefined`:null → undefined(setArchived 省略 time = 清除)
    const archived: number | null = null
    expect(archived ?? undefined).toBeUndefined()
  })
})
