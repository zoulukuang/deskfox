import { describe, expect, test } from "bun:test"
import { withQuitIntent } from "./updater-backend"
import type { UpdaterBackend } from "./updater-controller"

function fakeBackend(calls: string[]): UpdaterBackend {
  return {
    async checkForUpdates() {
      calls.push("check")
      return { isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }
    },
    async downloadUpdate() {
      calls.push("download")
    },
    quitAndInstall() {
      calls.push("quitAndInstall")
    },
  }
}

describe("withQuitIntent", () => {
  // 核心复现:bug 是 quitAndInstall 没先标记退出意图 → macOS「关闭到托盘」拦截 → app 不退、不升级。
  test("quitAndInstall 先标记退出意图,再委托底层(macOS close-to-tray 修复)", () => {
    const calls: string[] = []
    const wrapped = withQuitIntent(fakeBackend(calls), () => calls.push("markQuitIntent"))
    wrapped.quitAndInstall()
    // 顺序必须是「先标记、后退出安装」,否则窗口 close 会被拦成 hide
    expect(calls).toEqual(["markQuitIntent", "quitAndInstall"])
  })

  test("check / download 原样透传,不触发退出意图", async () => {
    const calls: string[] = []
    let marked = 0
    const wrapped = withQuitIntent(fakeBackend(calls), () => {
      marked++
    })
    const result = await wrapped.checkForUpdates()
    await wrapped.downloadUpdate()
    expect(result).toEqual({ isUpdateAvailable: true, updateInfo: { version: "2.0.0" } })
    expect(calls).toEqual(["check", "download"])
    expect(marked).toBe(0)
  })
})
