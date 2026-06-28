// FORK: REQ-068 — 启动默认项目 pre-check 决策单测(纯函数,平台无关)[feat: stale-path-hardening]
import { test, expect } from "bun:test"
import { checkProjectAvailable, decideStartupProject, openPickedDirectories } from "./startup-precheck"
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

// [bug-repro: openProject 改异步后,多选目录循环未 await → N 个 openProject 并发在飞 →
//  navigate 解析顺序不确定 → 最终落点非预期项目 / 死路径 toast 乱序]
test("openPickedDirectories 串行执行,任一时刻最多 1 个在飞(并发版会是 3)", async () => {
  let active = 0
  let maxActive = 0
  const completed: string[] = []
  // 第一个目录故意最慢:并发版完成顺序会乱成 b,c,a;串行版严格 a,b,c
  const openOne = (directory: string) =>
    new Promise<void>((resolve) => {
      active++
      maxActive = Math.max(maxActive, active)
      setTimeout(
        () => {
          completed.push(directory)
          active--
          resolve()
        },
        directory === "a" ? 30 : 5,
      )
    })
  await openPickedDirectories(["a", "b", "c"], openOne)
  expect(maxActive).toBe(1)
  expect(completed).toEqual(["a", "b", "c"])
})

test("openPickedDirectories: 单个 openOne 抛错不应吞掉(冒泡给调用方)", async () => {
  const boom = new Error("open failed")
  await expect(
    openPickedDirectories(["a"], async () => {
      throw boom
    }),
  ).rejects.toBe(boom)
})
