import { describe, expect, test } from "bun:test"
import { NsisUpdater } from "electron-updater"
import { configureReleaseUpdater } from "./updater-policy"

// Exercise electron-updater's real version decision without Electron, downloads or installs.
class ReleaseUpdater extends NsisUpdater {
  constructor() {
    super(undefined, {
      version: "2026.12.0",
      name: "DeskFox",
      isPackaged: true,
      appUpdateConfigPath: "",
      userDataPath: "",
      baseCachePath: "",
      whenReady: async () => {},
      relaunch() {},
      quit() {},
      onQuit() {},
    })
  }

  available(version: string) {
    return this.isUpdateAvailable({ version, files: [], releaseDate: "2026-10-20T00:00:00Z" })
  }
}

describe("release updater version policy", () => {
  test("an older online release cannot downgrade a newer installed candidate", async () => {
    const updater = new ReleaseUpdater()
    configureReleaseUpdater(updater)
    expect(await updater.available("2026.11.1")).toBe(false)
  })

  test("equal releases are ignored and genuinely newer releases remain available", async () => {
    const updater = new ReleaseUpdater()
    configureReleaseUpdater(updater)
    expect(await updater.available("2026.12.0")).toBe(false)
    expect(await updater.available("2026.12.1")).toBe(true)
  })

  test("channel configuration cannot re-enable downgrade or automatic installation", () => {
    const updater = new ReleaseUpdater()
    configureReleaseUpdater(updater)
    expect(updater.channel).toBe("latest")
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.allowPrerelease).toBe(false)
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })
})
