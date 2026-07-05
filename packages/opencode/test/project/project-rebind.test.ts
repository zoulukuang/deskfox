// FORK: REQ-061 M5 三态 — worktree 重绑判定单测(平台无关)[feat: stale-path-hardening]
import { test, expect } from "bun:test"
import { Effect } from "effect"
import {
  isWorktreeConfirmedMissing,
  keepSandboxUnlessConfirmedGone,
  isUnderWorktree,
  prefixRebindTarget,
} from "../../src/project/project-rebind"

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

// FORK: REQ-072 follow-up — session.directory 自愈纯函数单测(Logic 清单)2026-07-05
// [bug-repro: git 项目彻底改名重开后旧会话在侧栏不可见,改回原名才回来]
test("D1 isUnderWorktree:worktree 本身与其子路径判 true,其余 false", () => {
  expect(isUnderWorktree("/a/b", "/a/b")).toBe(true)
  expect(isUnderWorktree("/a/b/sub", "/a/b")).toBe(true)
  expect(isUnderWorktree("/a/bb", "/a/b")).toBe(false) // 前缀相似但非子路径
  expect(isUnderWorktree("/a", "/a/b")).toBe(false)
  expect(isUnderWorktree("C:\\p\\sub", "C:\\p")).toBe(true) // Windows 分隔符
})

test("D2 prefixRebindTarget:旧树根/子路径映射到新树,非旧树返回 undefined", () => {
  expect(prefixRebindTarget("/old", "/old", "/new")).toBe("/new")
  expect(prefixRebindTarget("/old/sub/x", "/old", "/new")).toBe("/new/sub/x")
  expect(prefixRebindTarget("/oldx", "/old", "/new")).toBeUndefined() // 前缀相似不误伤
  expect(prefixRebindTarget("/elsewhere", "/old", "/new")).toBeUndefined()
  expect(prefixRebindTarget("C:\\old\\s", "C:\\old", "D:\\new")).toBe("D:\\new\\s")
})
