import { describe, expect, test } from "bun:test"
import { projectTabKey } from "./session-key"

// FORK: REQ-041 后续 — 锁定「文件 tab 项目级共享」语义,防未来误改回会话级 [feat: iconbar-left-decouple]
describe("projectTabKey — 文件 tab 项目级共享 key", () => {
  test("去掉会话 id,只留项目 dir 段", () => {
    expect(projectTabKey("ZGlyMQ/ses_abc123")).toBe("ZGlyMQ")
  })

  test("无会话 id 时返回 dir 本身(新建/未选会话)", () => {
    expect(projectTabKey("ZGlyMQ")).toBe("ZGlyMQ")
  })

  test("同项目不同会话 → 同一 key(切话题共享文件 tab)", () => {
    expect(projectTabKey("proj/ses_1")).toBe(projectTabKey("proj/ses_2"))
    expect(projectTabKey("proj/ses_1")).toBe("proj")
  })

  test("不同项目 → 不同 key(切项目换文件 tab)", () => {
    expect(projectTabKey("projA/ses_1")).not.toBe(projectTabKey("projB/ses_1"))
  })

  test("空字符串兜底返回自身(不抛)", () => {
    expect(projectTabKey("")).toBe("")
  })

  test("多段只取第一段(dir 为 base64 不含 /,防御兜底)", () => {
    expect(projectTabKey("a/b/c")).toBe("a")
  })
})
