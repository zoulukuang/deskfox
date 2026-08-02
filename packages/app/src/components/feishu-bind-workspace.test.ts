// [feat: feishu-session-project-visibility] REQ-086 T1-T4
import { describe, expect, test } from "bun:test"
import { defaultWorkspaceForBind } from "./feishu-bind-workspace"

describe("defaultWorkspaceForBind", () => {
  test("T1: 有当前项目且账号未设 workspace → 注入项目目录", () => {
    expect(defaultWorkspaceForBind("/Users/me/proj", null)).toBe("/Users/me/proj")
    expect(defaultWorkspaceForBind("/Users/me/proj", undefined)).toBe("/Users/me/proj")
    expect(defaultWorkspaceForBind("/Users/me/proj", "")).toBe("/Users/me/proj")
  })

  test("T2: 账号已有 workspace(重绑)→ 不覆盖", () => {
    expect(defaultWorkspaceForBind("/Users/me/proj", "/existing/ws")).toBeNull()
    expect(defaultWorkspaceForBind("/Users/me/proj", "  /existing/ws  ")).toBeNull()
  })

  test("T3: 无打开项目 → 不注入(回退全局默认)", () => {
    expect(defaultWorkspaceForBind(undefined, null)).toBeNull()
    expect(defaultWorkspaceForBind(null, null)).toBeNull()
    expect(defaultWorkspaceForBind("", null)).toBeNull()
    expect(defaultWorkspaceForBind("   ", null)).toBeNull()
  })

  test("T4: 当前目录带首尾空白 → trim 后注入", () => {
    expect(defaultWorkspaceForBind("  /a/b  ", null)).toBe("/a/b")
  })
})
