// FORK: REQ-068 — 启动默认项目 pre-check 决策单测(纯函数,平台无关)[feat: stale-path-hardening]
import { test, expect } from "bun:test"
import { checkProjectAvailable, decideStartupProject } from "./startup-precheck"
import type { PathProbeResult } from "@/context/platform"

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

// FORK: REQ-068 加固 — 首页/启动复用的可用性判定(死路径手点防呆)。
// [bug-repro: 首页最近列表手点死路径仍进 openProject → 白屏+/file 500] 2026-06-26 [feat: stale-path-hardening]
const probeFn = (result: PathProbeResult) => async (_: string) => result

test("checkProjectAvailable: ok → available(可进项目)", async () => {
  expect(await checkProjectAvailable(probeFn({ ok: true }), "/p")).toEqual({ available: true })
})

test("checkProjectAvailable: 无探测能力(undefined)→ available(fail-open,不阻塞)", async () => {
  expect(await checkProjectAvailable(undefined, "/p")).toEqual({ available: true })
})

test("checkProjectAvailable: missing → 不可用 + forget + missing 文案 key", async () => {
  const status = await checkProjectAvailable(probeFn({ ok: false, reason: "missing", code: "ENOENT" }), "/p")
  expect(status).toEqual({
    available: false,
    forget: true,
    reason: "missing",
    titleKey: "project.path.missing.title",
    descKey: "project.path.missing.description",
  })
})

test("checkProjectAvailable: unreachable → 不可用 + 不 forget + unreachable 文案 key", async () => {
  const status = await checkProjectAvailable(
    probeFn({ ok: false, reason: "unreachable", code: "ETIMEDOUT" }),
    "/p",
  )
  expect(status).toEqual({
    available: false,
    forget: false,
    reason: "unreachable",
    titleKey: "project.path.unreachable.title",
    descKey: "project.path.unreachable.description",
  })
})

test("checkProjectAvailable: pathExists 抛错 → 容错按 available(不阻塞打开)", async () => {
  const throwing = async (_: string): Promise<PathProbeResult> => {
    throw new Error("ipc boom")
  }
  expect(await checkProjectAvailable(throwing, "/p")).toEqual({ available: true })
})
