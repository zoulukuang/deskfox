import type { UpdaterBackend } from "./updater-controller"

// FORK-ONLY: macOS 升级修复 [fix: macos-install-restart-no-quit] 2026-06-22
//
// 背景:DeskFox 有「关闭到托盘」(deskfox/tray.ts attachCloseToTray)——主窗口 close 默认被
// preventDefault + hide,只有 isQuittingFlag=true(setQuitting())时才放行真退。
//
// bug:点更新提示的「安装并重启」→ controller.install() → backend.quitAndInstall()。
// macOS 下 electron-updater 的 MacUpdater 调 Squirrel.Mac 原生 autoUpdater.quitAndInstall(),
// 走的是 `before-quit-for-update` 事件(非 `before-quit`),从不触发 setQuitting()。于是
// 触发的 app 退出序列里,主窗口 close 被「关闭到托盘」拦成 hide → app 不真退 → Squirrel.Mac
// 拿不到「进程已退出」时机、无法替换 .app bundle → 表现为「只关窗口、软件没退、也不升级」。
// Windows 的 NSIS 升级器是独立进程接管替换 + 强退,不经这套 close 拦截,故此 bug 仅 macOS。
//
// 修法:在我们自己掌控的调用点,quitAndInstall 之前显式标记退出意图(setQuitting),让
// 「关闭到托盘」拦截放行,窗口真关 → app 真退 → Squirrel.Mac 完成替换重启。抽成纯函数便于单测
// (Logic 清单:不引 electron,顺序可断言)。
export function withQuitIntent(backend: UpdaterBackend, markQuitIntent: () => void): UpdaterBackend {
  return {
    checkForUpdates: () => backend.checkForUpdates(),
    downloadUpdate: () => backend.downloadUpdate(),
    quitAndInstall: () => {
      markQuitIntent()
      backend.quitAndInstall()
    },
  }
}
