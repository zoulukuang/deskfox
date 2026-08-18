// FORK-ONLY: DeskFox 原生 IPC 注册 [feat: electron-replatform] 2026-06-12
//
// 注册 ipcMain.handle("deskfox:<cmd>") 处理器,对应 renderer 经 window.deskfox.invoke 发来的调用。
// 由 main/index.ts 在 app.whenReady 后调用 registerDeskfoxIpc()。
// 模块化:文件操作已落地;飞书/托盘/本地资源协议/防休眠/watchdog 后续逐模块补。

import { ipcMain, type IpcMainInvokeEvent } from "electron"
import * as fileOps from "./file-ops"
import * as preventSleep from "./prevent-sleep"
import * as feishu from "./feishu"
import * as telemetry from "./telemetry"
import { registerLocalAssetProtocol } from "./local-asset"
// FORK: native-menu-i18n [feat: native-menu-i18n]
import { applyContextMenuLanguage } from "./context-menu"
// REQ-084① 数据库隔离通知(一次性,renderer 就绪后取)[feat: voice-preclear-batch] 2026-08-18
import { takeDbQuarantineNotice } from "./db-quarantine-notice"

export function registerDeskfoxIpc() {
  // 本地资源协议(localasset://)— app.whenReady 后注册 [feat: electron-replatform]
  registerLocalAssetProtocol()

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
  h("open_in_terminal", fileOps.openInTerminal)
  h("get_file_mtime", fileOps.getFileMtime)
  h("get_file_size", fileOps.getFileSize)
  h("write_text_file", fileOps.writeTextFile)
  h("read_binary_file_base64", fileOps.readBinaryFileBase64)
  h("write_binary_file_absolute_base64", fileOps.writeBinaryFileAbsoluteBase64)
  h("fetch_url_base64", fileOps.fetchUrlBase64)

  // ── 防休眠(powerSaveBlocker)──
  h("get_prevent_sleep", preventSleep.getPreventSleep)
  h("set_prevent_sleep", preventSleep.setPreventSleep)

  // ── 原生右键菜单语言(跟随 app 内语言设置)[feat: native-menu-i18n] ──
  h("set_context_menu_language", (args: { locale?: string }) => {
    applyContextMenuLanguage(args.locale)
    return true
  })

  // ── 数据库隔离通知(REQ-084①,取走即清,不重复弹)[feat: voice-preclear-batch] ──
  h("get_db_quarantine_notice", () => takeDbQuarantineNotice())

  // ── 匿名使用统计(从 Tauri telemetry.rs 平移)[feat: telemetry-usage-stats] ──
  h("get_telemetry_enabled", () => telemetry.getTelemetryStatus())
  h("set_telemetry_enabled", (args: { enabled: boolean }) => telemetry.setTelemetryEnabled(args.enabled))
  h("track_event_cmd", (args: { name: string; blocking?: boolean }) => telemetry.trackEventCmd(args))

  // ── 飞书桥接(转发到 ~/.opencode/feishu-plugin-server.json 指向的插件 server)──
  h("feishu_adapter_status", feishu.feishuAdapterStatus)
  h("feishu_oauth_start", feishu.feishuOauthStart)
  h("feishu_oauth_poll", feishu.feishuOauthPoll)
  h("feishu_save_account", feishu.feishuSaveAccount)
  h("feishu_list_accounts", feishu.feishuListAccounts)
  h("feishu_delete_account", feishu.feishuDeleteAccount)
  h("feishu_update_account_model", feishu.feishuUpdateAccountModel)
  h("feishu_update_account_settings", feishu.feishuUpdateAccountSettings)
  h("feishu_pick_workspace_dir", feishu.feishuPickWorkspaceDir)
  h("feishu_list_providers", feishu.feishuListProviders)

  // 注:托盘/flush/sidecar-watchdog 均已在各自模块落地(tray.ts / index.ts);sidecar-watchdog
  //   事件经 mainWindow.webContents.send 广播,renderer 消费方待 deferred layout.tsx 一起接。
}
