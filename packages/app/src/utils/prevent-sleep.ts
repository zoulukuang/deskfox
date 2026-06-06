// FORK: 防休眠前端 invoke / event wrapper [feat: prevent-sleep] 2026-06-06
//
// 对齐 feishu-config.ts 的类型化封装惯例:命令名 / 事件名集中此处,组件不裸用 invoke,
// Rust 端重命名时这里集中改、不散落魔法字符串。

import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

/** 与 Rust prevent_sleep::PREVENT_SLEEP_CHANGED_EVENT 对齐 */
export const PREVENT_SLEEP_CHANGED_EVENT = "deskfox-prevent-sleep-changed"

/** 读当前防休眠状态(真相源在 Rust)*/
export async function getPreventSleep(): Promise<boolean> {
  return await invoke<boolean>("get_prevent_sleep")
}

/** 设置防休眠。Rust 端若实际未生效(系统拒绝 / 现代待机+电池)会 reject,调用方据此回滚 */
export async function setPreventSleep(enabled: boolean): Promise<void> {
  await invoke("set_prevent_sleep", { enabled })
}

/** 订阅托盘 / 其他入口的防休眠变更;返回 unlisten。注册失败由调用方 catch(e2e mock / 非 Tauri 环境无 event API)。*/
export async function onPreventSleepChanged(cb: (enabled: boolean) => void): Promise<() => void> {
  return await listen<boolean>(PREVENT_SLEEP_CHANGED_EVENT, (e) => cb(e.payload))
}
