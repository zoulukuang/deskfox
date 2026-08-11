import { app, dialog } from "electron"
import pkg from "electron-updater"
import { UPDATER_ENABLED } from "./constants"
import { createUpdaterController, type UpdaterReadyRecord } from "./updater-controller"
// FORK: macOS 升级修复 — quitAndInstall 前标记退出意图,绕开「关闭到托盘」拦截 [fix: macos-install-restart-no-quit] 2026-06-22
import { withQuitIntent } from "./updater-backend"
import { setQuitting } from "./deskfox/tray"
import { getLogger } from "./logging"
import { getStore } from "./store"
// FORK: 升级漏斗统计(update_downloaded / update_applied)[feat: telemetry-usage-stats] 2026-06-13
import { track, trackBlocking } from "./deskfox/telemetry"

// 每版本只发一次 update_downloaded(check 每 10 分钟跑,status=ready 会反复命中)
const downloadedReported = new Set<string>()
import { setAppQuitting } from "./windows"
import { nativeT } from "./native-translations"

const { autoUpdater } = pkg
const key = "ready"

export function setupAutoUpdater(stop: () => Promise<void>) {
  const logger = getLogger()
  autoUpdater.logger = logger
  autoUpdater.channel = "latest"
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  logger.log("auto updater configured", {
    channel: autoUpdater.channel,
    allowPrerelease: autoUpdater.allowPrerelease,
    allowDowngrade: autoUpdater.allowDowngrade,
    currentVersion: app.getVersion(),
  })

  const store = getStore("opencode.updater")
  return createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    backend: {
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      quitAndInstall: () => {
        // quitAndInstall closes all windows before emitting before-quit, so
        // flag the quit first to keep window ids persisted for restore.
        // FORK: 同步置托盘退出意图 — 否则 macOS 下窗口被「关闭到托盘」拦成 hide、app 不真退,
        //   Squirrel.Mac 无法替换 bundle(原 withQuitIntent 包装随上游重构收编于此)[feat: electron-macos-updater]
        setQuitting()
        setAppQuitting()
        try {
          autoUpdater.quitAndInstall()
        } catch (error) {
          // The install failed and the app keeps running; clear the flag so
          // deliberate window closes prune ids again.
          setAppQuitting(false)
          throw error
        }
      },
    },
    persistence: {
      get() {
        const value = store.get(key)
        if (!value || typeof value !== "object" || !("version" in value) || typeof value.version !== "string") return
        return { version: value.version } satisfies UpdaterReadyRecord
      },
      set: (value) => store.set(key, value),
      clear: () => store.delete(key),
    },
    stop,
    log: (message, data) => logger.log(message, data),
  })
}

export async function showUpdaterDialog(controller: ReturnType<typeof setupAutoUpdater>, alertOnFail: boolean) {
  const state = await controller.check()
  if (state.status === "error") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "error",
      message: nativeT("desktop.updater.dialog.checkFailed.message"),
      title: nativeT("desktop.updater.dialog.checkFailed.title"),
    })
    return
  }
  if (state.status === "up-to-date") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.upToDate.message"),
      title: nativeT("desktop.updater.dialog.upToDate.title"),
    })
    return
  }
  if (state.status !== "ready") return

  // FORK: 更新已下载就绪 → 发 update_downloaded(每版本一次)[feat: telemetry-usage-stats]
  if (state.version && !downloadedReported.has(state.version)) {
    downloadedReported.add(state.version)
    track("update_downloaded")
  }

  const response = await dialog.showMessageBox({
    type: "info",
    message: nativeT("desktop.updater.dialog.ready.message", { version: state.version }),
    title: nativeT("desktop.updater.dialog.ready.title"),
    buttons: [nativeT("desktop.updater.dialog.restart"), nativeT("desktop.updater.dialog.later")],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) {
    // FORK: relaunch 前阻塞发 update_applied(否则进程重启杀掉 fire-and-forget 请求)[feat: telemetry-usage-stats]
    await trackBlocking("update_applied")
    await controller.install()
  }
}
