// FORK-ONLY: DeskFox 防休眠 [feat: electron-replatform] 2026-06-12
//
// 从 Tauri prevent_sleep.rs(常驻 worker 线程持 keepawake guard)平移到 Electron powerSaveBlocker。
// Electron 原生 powerSaveBlocker.start/stop 无 per-thread 失效问题 → 砍掉整套 worker 线程复杂度,
// 只留 id 管理 + 变更事件广播(托盘/设置双入口同步)+ 开关状态持久化(重启恢复)。
// prevent-app-suspension:允许屏幕关,但压住系统睡眠(语义对齐原 keepawake)。

import { powerSaveBlocker, BrowserWindow } from "electron"

import { getStore } from "../store"
import { PREVENT_SLEEP_CONFIG_KEY } from "../store-keys"

// FORK: 事件名前缀 deskfox- 对齐 Tauri prevent_sleep::PREVENT_SLEEP_CHANGED_EVENT 与前端
// utils/prevent-sleep.ts。经 deskfox: 桥广播后,前端监听的频道 = deskfox:deskfox-prevent-sleep-changed。
// 此前漏了前缀(仅 "prevent-sleep-changed")→ 托盘与设置页开关无法双向同步。[feat: electron-replatform-macos]
export const PREVENT_SLEEP_CHANGED_EVENT = "deskfox-prevent-sleep-changed"

let blockerId: number | null = null

export function getPreventSleep(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId)
}

// 变更订阅(托盘"保持电脑不休眠"勾选项与设置页双入口同步)— 对齐 Tauri set_prevent_sleep_check
const subscribers = new Set<(enabled: boolean) => void>()
export function onPreventSleepChanged(cb: (enabled: boolean) => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

function broadcast(enabled: boolean) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(`deskfox:${PREVENT_SLEEP_CHANGED_EVENT}`, enabled)
  }
  for (const cb of subscribers) {
    try {
      cb(enabled)
    } catch {
      /* 订阅者异常不影响其它 */
    }
  }
}

/** 纯函数:从 store value 解析 enabled,任何缺失 / 类型错 → 默认 false(关)。对齐 Tauri enabled_from_store_value(单测覆盖)。 */
export function enabledFromStoreValue(v: unknown): boolean {
  return typeof v === "object" && v !== null && (v as { enabled?: unknown }).enabled === true
}

// persist 失败只 warn,不回退已应用的运行态(对齐 Tauri:存盘失败不该擅自改变用户当前电源行为)。
function persist(enabled: boolean): void {
  try {
    getStore().set(PREVENT_SLEEP_CONFIG_KEY, { enabled })
  } catch (e) {
    console.warn("[prevent-sleep] persist 失败(运行态不回退):", e)
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
  const actual = getPreventSleep()
  broadcast(actual)
  persist(actual)
}

/** 启动恢复:读上次持久化的开关,开着则立即重新生效 + 同步托盘/前端(对齐 Tauri lib.rs:527 read_persisted)。 */
export function restorePreventSleep(): void {
  let stored: unknown
  try {
    stored = getStore().get(PREVENT_SLEEP_CONFIG_KEY)
  } catch {
    stored = undefined
  }
  if (enabledFromStoreValue(stored)) {
    setPreventSleep({ enabled: true })
  }
}
