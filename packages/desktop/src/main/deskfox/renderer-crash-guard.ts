// FORK-ONLY: REQ-087 renderer 连环崩自愈 [feat: renderer-snapshot-oom] 2026-08-02
//
// 背景:超大状态快照(.dat)落盘后,renderer 启动恢复即 stringify OOM → 崩 → 重启 29s 再崩
// (Crashpad dump 实证),用户侧表现为「一打开就崩」死循环。主进程是唯一能打破循环的位置:
// 检测到崩溃循环时把 renderer 快照 .dat 隔离(改名 .bak-<ts>,保留原件可恢复),再 reload。
// `opencode.settings`(窗口尺寸/基础设置)与崩溃无关,不动。

import { rename, readdir } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import type { WebContents } from "electron"

/** 判定窗口:两次可数崩溃间隔小于该值 → 连环崩。 */
export const CRASH_LOOP_WINDOW_MS = 120_000

// Electron render-process-gone 的 reason 里,只有这些算「异常崩溃」;
// clean-exit / killed(用户或 OS 主动)不计数,避免误伤正常操作。
const COUNTED_REASONS = new Set(["crashed", "oom", "abnormal-exit", "integrity-failure", "launch-failed"])

export function isCountedCrashReason(reason: string): boolean {
  return COUNTED_REASONS.has(reason)
}

/** renderer 状态快照文件族(见 packages/app/src/utils/persist.ts 的 storage 命名)。 */
export function isSnapshotFile(name: string): boolean {
  if (name === "default.dat" || name === "opencode.global.dat") return true
  if (/^opencode\.workspace\..+\.dat$/.test(name)) return true
  if (/^opencode\.draft\..+\.dat$/.test(name)) return true
  return false
}

/**
 * 崩溃循环检测器:record() 返回 true 表示「窗口期内的第 2 次可数崩溃」= 连环崩,
 * 且随即清空计数(隔离动作只做一次,之后重新累计)。
 */
export function createCrashLoopDetector(now: () => number = Date.now) {
  let lastCrashAt: number | undefined
  return {
    record(reason: string): boolean {
      if (!isCountedCrashReason(reason)) return false
      const at = now()
      const loop = lastCrashAt !== undefined && at - lastCrashAt < CRASH_LOOP_WINDOW_MS
      lastCrashAt = loop ? undefined : at
      return loop
    },
  }
}

/**
 * 隔离 userData 下所有快照 .dat(rename 为 `<name>.bak-<ts>`),返回被隔离的文件名列表。
 * rename 失败单个跳过不中断(尽力而为;残留文件下次循环再试)。
 */
const detector = createCrashLoopDetector()

/**
 * index.ts render-process-gone 接入点:连环崩时隔离快照并 reload,单次崩溃只计数不动作。
 * (reload 只在隔离后做——保持既有「单次崩溃仅记日志」行为不变,改动面最小。)
 */
export async function handleRendererGone(
  webContents: WebContents,
  reason: string,
  log: (message: string, data?: Record<string, unknown>) => void = () => {},
): Promise<void> {
  if (!detector.record(reason)) return
  const moved = await quarantineSnapshots(app.getPath("userData"))
  log("renderer crash loop detected, quarantined snapshot files", { reason, moved })
  if (!webContents.isDestroyed()) webContents.reload()
}

export async function quarantineSnapshots(userDataPath: string, timestamp = Date.now()): Promise<string[]> {
  const names = await readdir(userDataPath).catch(() => [] as string[])
  const moved: string[] = []
  for (const name of names) {
    if (!isSnapshotFile(name)) continue
    const from = path.join(userDataPath, name)
    const to = path.join(userDataPath, `${name}.bak-${timestamp}`)
    try {
      await rename(from, to)
      moved.push(name)
    } catch {
      // 尽力而为
    }
  }
  return moved
}
