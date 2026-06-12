// FORK-ONLY: DeskFox 原生 IPC 注册 [feat: electron-replatform] 2026-06-12
//
// 注册 ipcMain.handle("deskfox:<cmd>") 处理器,对应 renderer 经 window.deskfox.invoke 发来的调用。
// 由 main/index.ts 在 app.whenReady 后调用 registerDeskfoxIpc()。
// 模块化:文件操作已落地;飞书/托盘/本地资源协议/防休眠/watchdog 后续逐模块补。

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import * as fileOps from "./file-ops"

export function registerDeskfoxIpc() {
  const h = (cmd: string, fn: (args: any) => unknown) =>
    ipcMain.handle(`deskfox:${cmd}`, (_e: IpcMainInvokeEvent, args: unknown) => fn((args ?? {}) as any))

  // ── 文件操作(从 Tauri lib.rs / text_file.rs 平移)──
  h("copy_path", fileOps.copyPath)
  h("create_directory", fileOps.createDirectory)
  h("create_empty_file", fileOps.createEmptyFile)
  h("next_available_path", fileOps.nextAvailablePath)
  h("rename_path", fileOps.renamePath)
  h("trash_path", fileOps.trashPath)
  h("open_path", fileOps.openPath)
  h("reveal_in_folder", fileOps.revealInFolder)
  h("get_file_mtime", fileOps.getFileMtime)
  h("get_file_size", fileOps.getFileSize)
  h("write_text_file", fileOps.writeTextFile)
  h("read_binary_file_base64", fileOps.readBinaryFileBase64)
  h("write_binary_file_absolute_base64", fileOps.writeBinaryFileAbsoluteBase64)
  h("fetch_url_base64", fileOps.fetchUrlBase64)

  // TODO[electron-replatform]: 防休眠(get/set_prevent_sleep)、飞书(10 command)、事件(flush-before-close/sidecar-watchdog)逐模块补
}
