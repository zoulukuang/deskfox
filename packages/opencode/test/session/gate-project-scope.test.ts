import { describe, expect, test } from "bun:test"
import { ProjectV2 } from "@opencode-ai/core/project"
import { gateProjectScope } from "@/session/session"

// REQ-072 会话侧栏项目维度 — global 门控纯函数单测(Logic 清单)
// 不变量:有真实身份按 project_id 列(改名/挪位/复制跟随);global 哨兵回落 directory 守大杂烩。

const REAL = ProjectV2.ID.make("fld_realproject")
const GLOBAL = ProjectV2.ID.global

describe("gateProjectScope (REQ-072 会话侧栏项目维度门控)", () => {
  // TC-B1: scope=project + 真实 projectID → 原样透传(只按 project_id、忽略 directory)
  test("TC-B1: scope=project + 真实身份 → 原样按 project_id,忽略 directory", () => {
    const input = { scope: "project" as const, directory: "/old/path", roots: true }
    const out = gateProjectScope(input, { projectID: REAL, directory: "/new/path" })
    expect(out).toBe(input) // 原样引用透传,scope 保留 → listByProject 走 project_id、丢 directory 过滤
    expect(out?.scope).toBe("project")
  })

  // TC-B2: scope=project + global 哨兵 → 降级 scope=undefined + 保留 directory 过滤(守大杂烩)
  test("TC-B2: scope=project + global → 降级回 directory 过滤(守大杂烩)", () => {
    const input = { scope: "project" as const, directory: "/global/dirA", roots: true }
    const out = gateProjectScope(input, { projectID: GLOBAL, directory: "/global/ctx" })
    expect(out?.scope).toBeUndefined() // 降级 → listByProject 的 scope!=="project" 分支重新叠 directory 过滤
    expect(out?.directory).toBe("/global/dirA") // 保留显式 directory
    expect(out?.roots).toBe(true)
  })

  // TC-B3: 不传 scope(其它 caller)→ 完全不变
  test("TC-B3: 无 scope(其它 caller)→ 原样透传,行为不变", () => {
    const input = { directory: "/some/dir", roots: true }
    expect(gateProjectScope(input, { projectID: REAL, directory: "/ctx" })).toBe(input)
    expect(gateProjectScope(input, { projectID: GLOBAL, directory: "/ctx" })).toBe(input)
  })

  test("TC-B3b: input=undefined → 返回 undefined", () => {
    expect(gateProjectScope(undefined, { projectID: GLOBAL, directory: "/ctx" })).toBeUndefined()
    expect(gateProjectScope(undefined, { projectID: REAL, directory: "/ctx" })).toBeUndefined()
  })

  // TC-B4: scope=project + global + handler 已 drop directory(undefined)→ 回填 ctx.directory
  test("TC-B4: scope=project + global + directory 缺失 → 回填 ctx.directory(不退化大杂烩)", () => {
    const input = { scope: "project" as const, roots: true } // handler 在 scope=project 时置 directory=undefined
    const out = gateProjectScope(input, { projectID: GLOBAL, directory: "/global/ctxdir" })
    expect(out?.scope).toBeUndefined()
    expect(out?.directory).toBe("/global/ctxdir") // 回填 → 仍按当前目录过滤,不列全部 global 会话
  })

  // 非 global 真实身份即使 directory 缺失也原样透传(scope 保留 → 不需要 directory)
  test("TC-B1b: scope=project + 真实身份 + directory 缺失 → 原样透传(不回填,靠 project_id)", () => {
    const input = { scope: "project" as const, roots: true }
    const out = gateProjectScope(input, { projectID: REAL, directory: "/ctx" })
    expect(out).toBe(input)
    expect(out?.directory).toBeUndefined()
  })
})
