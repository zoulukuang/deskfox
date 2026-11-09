import type { AppUpdater } from "electron-updater"

// FORK: Keep the release update policy together: assigning channel enables downgrades. 2026-10-20
export function configureReleaseUpdater(updater: AppUpdater) {
  updater.channel = "latest"
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
}
