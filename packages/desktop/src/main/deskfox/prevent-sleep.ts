// FORK-ONLY: DeskFox 防休眠 [feat: electron-replatform] 2026-06-12
//
// 从 Tauri prevent_sleep.rs(常驻 worker 线程持 keepawake guard)平移到 Electron powerSaveBlocker。
// Electron 原生 powerSaveBlocker.start/stop 无 per-thread 失效问题 → 砍掉整套 worker 线程复杂度,
// 只留 id 管理 + 变更事件广播(托盘/设置双入口同步)。
// prevent-app-suspension:允许屏幕关,但压住系统睡眠(语义对齐原 keepawake)。

import { powerSaveBlocker, BrowserWindow } from "electron"

export const PREVENT_SLEEP_CHANGED_EVENT = "prevent-sleep-changed"

let blockerId: number | null = null

export function getPreventSleep(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId)
}

function broadcast(enabled: boolean) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(`deskfox:${PREVENT_SLEEP_CHANGED_EVENT}`, enabled)
  }
}

export function setPreventSleep(args: { enabled: boolean }): void {
  if (args.enabled) {
    if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
      blockerId = powerSaveBlocker.start("prevent-app-suspension")
    }
  } else if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
  broadcast(getPreventSleep())
}
