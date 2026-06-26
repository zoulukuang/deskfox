// FORK: REQ-061 M5 三态 — worktree 重绑判定单测(平台无关)[feat: stale-path-hardening]
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { isWorktreeConfirmedMissing, keepSandboxUnlessConfirmedGone } from "../../src/project/project-rebind"

const run = <A>(eff: Effect.Effect<A>) => Effect.runSync(eff)

test("exists 返回 false(ENOENT 确切不存在)→ 判 missing(应重绑)", () => {
  expect(run(isWorktreeConfirmedMissing(Effect.succeed(false)))).toBe(true)
})

test("exists 返回 true(仍在)→ 不判 missing(不重绑)", () => {
  expect(run(isWorktreeConfirmedMissing(Effect.succeed(true)))).toBe(false)
})

test("exists 失败(EACCES/网络盘离线/U盘暂拔/超时,检查出错)→ 保守不判 missing(不误重绑)", () => {
  const eacces = Effect.fail(new Error("EACCES: permission denied"))
  expect(run(isWorktreeConfirmedMissing(eacces))).toBe(false)
})

test("exists 失败(任意 PlatformError 形态)→ 一律保守不重绑", () => {
  for (const code of ["EBUSY", "ENXIO", "ETIMEDOUT", "EPERM"]) {
    const err = Effect.fail(new Error(`${code}: device error`))
    expect(run(isWorktreeConfirmedMissing(err))).toBe(false)
  }
})

// FORK: REQ-064 加固 — 沙箱保留三态(离线盘 orDie→500 回归修复)。
// [bug-repro: 离线 sandbox exists 出错 Effect.orDie 把 update 升级成 500] 2026-06-26 [feat: stale-path-hardening]
test("C1 exists 返回 true(仍在)→ 保留 sandbox", () => {
  expect(run(keepSandboxUnlessConfirmedGone("/proj/sbx", Effect.succeed(true)))).toBe("/proj/sbx")
})

test("C2 exists 返回 false(确切不存在)→ 剔除(undefined)", () => {
  expect(run(keepSandboxUnlessConfirmedGone("/proj/sbx", Effect.succeed(false)))).toBeUndefined()
})

test("C3 exists 失败(离线盘/EACCES,检查出错)→ 保守保留 sandbox(不 die、不误删)", () => {
  const eacces = Effect.fail(new Error("EACCES: device offline"))
  expect(run(keepSandboxUnlessConfirmedGone("/proj/sbx", eacces))).toBe("/proj/sbx")
})

test("C3b exists 失败(各 PlatformError 形态)→ 一律保守保留", () => {
  for (const code of ["EBUSY", "ENXIO", "ETIMEDOUT", "EPERM"]) {
    const err = Effect.fail(new Error(`${code}: device error`))
    expect(run(keepSandboxUnlessConfirmedGone("/proj/sbx", err))).toBe("/proj/sbx")
  }
})
