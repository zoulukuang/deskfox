import { describe, expect, test } from "bun:test"
import { projectTabKey, synthTabs } from "./session-key"

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

// FORK: REQ-042 #3 — 锁定「文件 tab 项目级 + 审查/上下文会话级」的合成规则
describe("synthTabs — 项目级文件 tab + 会话级伪标签合成", () => {
  test("无伪标签时:原样返回文件 tab + 文件 active", () => {
    const files = { all: ["file://a", "file://b"], active: "file://a" }
    expect(synthTabs(files, undefined)).toEqual(files)
    expect(synthTabs(files, {})).toEqual(files)
  })

  test("会话伪标签 active 覆盖文件 active(切会话看审查不影响别会话)", () => {
    const files = { all: ["file://a"], active: "file://a" }
    expect(synthTabs(files, { active: "review" }).active).toBe("review")
    expect(synthTabs(files, { active: "context" }).active).toBe("context")
    // 文件列表不受伪标签影响(项目级保持)
    expect(synthTabs(files, { active: "review" }).all).toEqual(["file://a"])
  })

  test("会话开了上下文 → context 拼到文件 tab 最前", () => {
    const files = { all: ["file://a", "file://b"], active: "file://a" }
    expect(synthTabs(files, { context: true }).all).toEqual(["context", "file://a", "file://b"])
  })

  test("两个会话共享同一份项目文件,但各自伪标签独立(不串味)", () => {
    const files = { all: ["file://a"], active: "file://a" } // 项目级共享
    const sessionA = synthTabs(files, { active: "review" }) // A 在看审查
    const sessionB = synthTabs(files, undefined) // B 没看伪标签
    expect(sessionA.active).toBe("review")
    expect(sessionB.active).toBe("file://a") // B 不受 A 的审查 active 影响
    expect(sessionA.all).toEqual(sessionB.all) // 文件 tab 仍共享
  })
})
