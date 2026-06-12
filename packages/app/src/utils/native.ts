// FORK-ONLY: Electron 原生桥 [feat: electron-replatform] 2026-06-12
//
// 平台 IPC 缝 —— 替代 Tauri `@tauri-apps/api/core` 的 invoke + `@tauri-apps/api/event` 的 listen。
// 签名刻意与 Tauri 兼容,fork 的 app 调用点(原直接 import @tauri-apps)只需把 import 来源换成本模块,
// 其余零改动(invoke<T>(cmd,args) / listen<T>(event, e=>e.payload) 形态一致)。
//
// 底层走 Electron preload 经 contextBridge 暴露的 `window.deskfox`(由 fork preload 注入,
// main 进程 ipcMain.handle 实现 —— 均属【阶段3 桌面能力移植】,本缝只定 renderer 侧契约 + 类型)。
//
// ┌─ 契约(阶段3 main 须实现)─────────────────────────────────────────────┐
// │ invoke(cmd, args) — 23 命令(从 fork Tauri #[command] 平移):           │
// │   文件操作: copy_path / create_directory / create_empty_file /         │
// │     next_available_path / rename_path / trash_path / open_path /       │
// │     reveal_in_folder / get_file_mtime / get_file_size / write_text_file/│
// │     read_binary_file_base64 / write_binary_file_absolute_base64 /      │
// │     fetch_url_base64                                                    │
// │   防休眠: get_prevent_sleep / set_prevent_sleep                         │
// │   飞书: feishu_oauth_start / feishu_oauth_poll / feishu_adapter_status /│
// │     feishu_save_account / feishu_list_accounts / feishu_delete_account /│
// │     feishu_update_account_model / feishu_update_account_settings /      │
// │     feishu_pick_workspace_dir / feishu_list_providers                  │
// │ listen(event) — 2 事件: deskfox-flush-before-close / sidecar-watchdog  │
// └────────────────────────────────────────────────────────────────────────┘

export type DeskfoxBridge = {
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>
  listen: <T = unknown>(event: string, handler: (payload: T) => void) => Promise<() => void>
}

declare global {
  interface Window {
    deskfox?: DeskfoxBridge
  }
}

function bridge(): DeskfoxBridge {
  const b = typeof window !== "undefined" ? window.deskfox : undefined
  if (!b) throw new Error("DeskFox 原生桥未注入(非 Electron 环境,或 preload 未加载)")
  return b
}

/** Tauri `invoke` 兼容替代。命令名见上方契约表。 */
export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return bridge().invoke<T>(cmd, args)
}

/** Tauri `listen` 兼容替代。handler 收 `{ payload }`(与 Tauri 事件形态一致),返回 unlisten。 */
export function listen<T = unknown>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  return bridge().listen<T>(event, (payload) => handler({ payload }))
}
