// FORK-ONLY: REQ-087 连环崩自愈单测 [feat: renderer-snapshot-oom] 2026-08-02
import { describe, expect, mock, test } from "bun:test"
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// renderer-crash-guard 顶层 import electron(handleRendererGone 用 app.getPath);
// 单测环境无 electron 主进程,mock 掉。
mock.module("electron", () => ({ app: { getPath: () => "/tmp" } }))

const { CRASH_LOOP_WINDOW_MS, createCrashLoopDetector, isCountedCrashReason, isSnapshotFile, quarantineSnapshots } =
  await import("./renderer-crash-guard")

describe("crash loop detector", () => {
  test("second counted crash inside the window is a loop, then counter resets", () => {
    let now = 1_000
    const detector = createCrashLoopDetector(() => now)
    expect(detector.record("oom")).toBeFalse()
    now += 29_000 // 29s 复崩(Crashpad 实证形态)
    expect(detector.record("crashed")).toBeTrue()
    // 隔离动作做过一次后重新累计:紧接着的一次不再立即判 loop
    now += 1_000
    expect(detector.record("crashed")).toBeFalse()
    now += 1_000
    expect(detector.record("crashed")).toBeTrue()
  })

  test("crashes outside the window never form a loop", () => {
    let now = 0
    const detector = createCrashLoopDetector(() => now)
    expect(detector.record("oom")).toBeFalse()
    now += CRASH_LOOP_WINDOW_MS + 1
    expect(detector.record("oom")).toBeFalse()
  })

  test("clean-exit / killed are not counted", () => {
    let now = 0
    const detector = createCrashLoopDetector(() => now)
    expect(isCountedCrashReason("clean-exit")).toBeFalse()
    expect(isCountedCrashReason("killed")).toBeFalse()
    expect(detector.record("clean-exit")).toBeFalse()
    now += 10
    expect(detector.record("oom")).toBeFalse() // clean-exit 未记时间戳,首次 oom 不判 loop
  })
})

describe("snapshot file matching", () => {
  test("matches renderer snapshot families only", () => {
    expect(isSnapshotFile("opencode.global.dat")).toBeTrue()
    expect(isSnapshotFile("default.dat")).toBeTrue()
    expect(isSnapshotFile("opencode.workspace.repo.abc123.dat")).toBeTrue()
    expect(isSnapshotFile("opencode.draft.d1.9f.dat")).toBeTrue()
    expect(isSnapshotFile("opencode.settings")).toBeFalse()
    expect(isSnapshotFile("opencode.db")).toBeFalse()
    expect(isSnapshotFile("opencode.global.dat.bak-1")).toBeFalse()
    expect(isSnapshotFile("auth.json")).toBeFalse()
  })
})

describe("quarantineSnapshots", () => {
  test("renames snapshot files with .bak suffix and leaves the rest", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "crash-guard-"))
    writeFileSync(path.join(dir, "opencode.global.dat"), "{}")
    writeFileSync(path.join(dir, "opencode.workspace.repo.abc.dat"), "{}")
    writeFileSync(path.join(dir, "opencode.settings"), "{}")
    writeFileSync(path.join(dir, "opencode.db"), "sqlite")

    const moved = await quarantineSnapshots(dir, 42)
    expect(moved.sort()).toEqual(["opencode.global.dat", "opencode.workspace.repo.abc.dat"])

    const names = readdirSync(dir).sort()
    expect(names).toEqual([
      "opencode.db",
      "opencode.global.dat.bak-42",
      "opencode.settings",
      "opencode.workspace.repo.abc.dat.bak-42",
    ])
  })

  test("missing directory yields empty result", async () => {
    expect(await quarantineSnapshots("/nonexistent/path/for/sure")).toEqual([])
  })
})
