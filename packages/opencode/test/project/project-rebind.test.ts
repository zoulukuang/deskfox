// FORK: REQ-061 M5 三态 — worktree 重绑判定单测(平台无关)[feat: stale-path-hardening]
import { test, expect } from "bun:test"
import { Effect } from "effect"
import { isWorktreeConfirmedMissing } from "../../src/project/project-rebind"

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
