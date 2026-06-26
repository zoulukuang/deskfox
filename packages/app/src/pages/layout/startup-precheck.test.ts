// FORK: REQ-068 — 启动默认项目 pre-check 决策单测(纯函数,平台无关)[feat: stale-path-hardening]
import { test, expect } from "bun:test"
import { decideStartupProject } from "./startup-precheck"

test("目录存在(ok)→ open", () => {
  expect(decideStartupProject({ ok: true })).toEqual({ action: "open" })
})

test("目录确切不存在(missing)→ skip + forget(清 lastProject)", () => {
  expect(decideStartupProject({ ok: false, reason: "missing", code: "ENOENT" })).toEqual({
    action: "skip",
    forget: true,
    reason: "missing",
  })
})

test("目录暂不可达(unreachable)→ skip 但不 forget(保留 lastProject 提示重试)", () => {
  expect(decideStartupProject({ ok: false, reason: "unreachable", code: "ETIMEDOUT" })).toEqual({
    action: "skip",
    forget: false,
    reason: "unreachable",
  })
})

test("无探测能力 / 探测出错(undefined)→ fail-open,不阻塞启动", () => {
  expect(decideStartupProject(undefined)).toEqual({ action: "open" })
})

test("missing 一定不进 openProject(action !== open)", () => {
  const decision = decideStartupProject({ ok: false, reason: "missing", code: "ENOENT" })
  expect(decision.action).not.toBe("open")
})
