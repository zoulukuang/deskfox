feat-id: macos-install-restart-no-quit
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# macOS「安装并重启」只关窗口不升级 — 修复

> 规模:Tiny(2 个小新文件 + 3 行接线)。1-spec / 2-plan 省略,详见本 changelog。

## 症状(用户反馈 2026-06-22)

已装 DeskFox 收到「有可用更新 / 安装并重启」提示,点「安装并重启」后**只把桌面窗口关掉,整个软件不真退出,也不升级**。**仅 macOS,Windows 正常**。

## 根因

DeskFox 有「关闭到托盘」(`deskfox/tray.ts` `attachCloseToTray`):主窗口 `close` 事件在 `isQuittingFlag=false` 时 `preventDefault()` + `win.hide()`,只有 `setQuitting()` 置位后才放行真退出。`setQuitting()` 仅在托盘「退出」菜单和 `app.on("before-quit")` 里调用。

而「安装并重启」→ `controller.install()` → `backend.quitAndInstall()`。macOS 下 electron-updater 的 `MacUpdater` 调 Squirrel.Mac 原生 `autoUpdater.quitAndInstall()`,触发的退出走 `before-quit-for-update` 事件(**非** `before-quit`),从不触发 `setQuitting()`。于是退出序列里主窗口 `close` 被「关闭到托盘」拦成 `hide` → app 不真退 → Squirrel.Mac 拿不到「进程已退出」时机、无法替换 `.app` bundle → 表现为「只关窗口、没退、不升级」。

Windows 的 NSIS 升级器是独立进程接管替换 + 强退,不经这套 close 拦截,故此 bug 仅 macOS。

(注:与 [reference_macos_updater_appledouble_trap] 的 Tauri 时代 updater bug 无关 —— 那是 AppleDouble tarball 解压失败,本次是 Electron 基座的退出意图未传导。)

## 修复

`quitAndInstall()` 调用前显式标记退出意图。抽纯函数 `withQuitIntent(backend, markQuitIntent)`(helper-extract,Logic 清单)包一层 backend,其 `quitAndInstall` 先 `markQuitIntent()` 再委托底层;`updater.ts` 用 `withQuitIntent(autoUpdater, setQuitting)` 作 backend。退出意图置位后「关闭到托盘」放行 → 窗口真关 → app 真退 → Squirrel.Mac 完成替换重启。

## 改动文件

- `packages/desktop/src/main/updater-backend.ts`(新增,纯函数 `withQuitIntent` + 根因注释)
- `packages/desktop/src/main/updater-backend.test.ts`(新增,复现测试:断言 quitAndInstall 先标记退出意图再委托 + check/download 透传不误触)
- `packages/desktop/src/main/updater.ts`(接线:import `withQuitIntent` + `setQuitting`,backend 包一层)

## 回归测试

- 新增 `updater-backend.test.ts` 2 pass(顺序断言 + 透传断言)
- 既有 `updater-controller.test.ts` 6 pass、desktop `src/main/` 全量 71 pass、`@opencode-ai/desktop` typecheck 通过 —— 无连带破坏

## 待验证(真机)

单测覆盖纯逻辑顺序;**Squirrel.Mac 实际替换 bundle + 重启**无法 CDP 自测,需真机端到端:装一个低版本 + 升级源指向更高版本,点「安装并重启」确认软件真退出并升级重启。建议下次发 2026.8.2 时验。

## 回退方法

`updater.ts` 把 `backend: withQuitIntent(autoUpdater, setQuitting)` 改回 `backend: autoUpdater`,删两个新文件即可(单点可逆)。
