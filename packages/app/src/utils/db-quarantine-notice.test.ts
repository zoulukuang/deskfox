// FORK-ONLY: REQ-084① 数据库隔离提示单测 [feat: voice-preclear-batch] 2026-08-18
import { describe, expect, test } from "bun:test"
import { toQuarantineToast } from "./db-quarantine-notice"

describe("toQuarantineToast", () => {
  test("无通知 → 不弹", () => {
    expect(toQuarantineToast(null)).toBeUndefined()
    expect(toQuarantineToast(undefined)).toBeUndefined()
  })

  test("空 dbNames → 不弹(没实际发生隔离就别吓用户)", () => {
    expect(toQuarantineToast({ kind: "startup", dbNames: [] })).toBeUndefined()
  })

  test("startup:说明已备份 + 给出目录", () => {
    const t = toQuarantineToast({ kind: "startup", dbNames: ["opencode.db"], dir: "/home/u/.local/share/deskfox/opencode" })
    expect(t?.title).toContain("已另存备份")
    expect(t?.description).toContain("/home/u/.local/share/deskfox/opencode")
    // 必须明确「没删」,这是用户最担心的
    expect(t?.description).toContain("没有被删除")
  })

  test("migrate:说明未迁入 + 账号配置已迁 + 原件保留", () => {
    const t = toQuarantineToast({ kind: "migrate", dbNames: ["opencode.db"], dir: "/home/u/.local/share/opencode" })
    expect(t?.title).toContain("未迁入")
    expect(t?.description).toContain("账号与配置已正常迁入")
    expect(t?.description).toContain("完整保留")
  })

  test("无 dir → 文案仍完整,不出现 undefined", () => {
    const t = toQuarantineToast({ kind: "startup", dbNames: ["opencode.db"] })
    expect(t?.description).not.toContain("undefined")
    expect(t?.description).toContain("已保留")
  })

  test("variant 用 default 而非 error(数据没丢,不该报红)", () => {
    expect(toQuarantineToast({ kind: "startup", dbNames: ["a.db"] })?.variant).toBe("default")
    expect(toQuarantineToast({ kind: "migrate", dbNames: ["a.db"] })?.variant).toBe("default")
  })

  // FORK: 2026-08-19 发版前 review —— 这条通知一辈子只弹一次(主进程取走即清),
  //   内容里带着用户需要复制的恢复路径。走默认 5 秒自动消失 = 去倒杯水回来就再也找不到数据在哪。
  test("两种场景都常驻不自动消失(一次性通知 + 带恢复路径)", () => {
    expect(toQuarantineToast({ kind: "startup", dbNames: ["a.db"], dir: "/tmp/x" })?.persistent).toBe(true)
    expect(toQuarantineToast({ kind: "migrate", dbNames: ["a.db"], dir: "/tmp/x" })?.persistent).toBe(true)
  })
})
