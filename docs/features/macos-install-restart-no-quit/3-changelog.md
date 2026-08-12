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

## 真机验证 ✅(2026-08-11,mac prod 2026.9.1 发版期间达成)

原计划:装一个低版本 + 升级源指向更高版本,点「安装并重启」确认软件真退出并升级重启。
**2026-08-11 自然达成并通过** —— 本机 2026.9.0 经应用内升级到 2026.9.1,Squirrel.Mac 完成换包与重启。

**证据**(`~/Library/Caches/ai.deskfox.app.ShipIt/ShipIt_stderr.log`,系统会清理故此处摘录留档):

```
22:53      下载 DeskFox-2026.9.1-mac-arm64.zip(337,410,153 bytes)→ deskfox-updater/pending/
22:54:07   ShipIt 换 bundle(targetBundleURL=/Applications/DeskFox.app)
22:54:08   Installation completed successfully
22:54:12   Successfully launched application at file:///Applications/DeskFox.app/
22:54:12   ShipIt status 0
```

`ShipItState.plist` 记录 `launchAfterInstallation = true` / `bundleIdentifier = ai.deskfox.app`。

**为什么这能证明本修复有效**:本 bug 的形态是「app 不真退出 → Squirrel 拿不到替换 bundle 的机会 → 升级静默失败」。
日志出现 `Installation completed successfully` + `status 0` + 成功重启,说明**进程确实真退出了**,`withQuitIntent`
在 `quitAndInstall()` 前标记退出意图、绕开「关闭到托盘」拦截的路径按预期工作。

**附带确认(同样重要)**:升级后 `xcrun stapler validate /Applications/DeskFox.app` 仍 `The validate action worked!`
—— Squirrel 换包**没有破坏公证票**,用户升级后不会撞 Gatekeeper。

**日志噪音辨识**(免得后人误判):该日志累计 32 行命中 error/fail 关键词,属于本次升级的只有 2 行且均非故障 ——
① `Couldn't remove owned bundle ... The file doesn't exist`(清理临时目录时它已不存在,发生在"安装成功"前 0.5 秒的收尾阶段)
② `ERROR: Unrecognized attribute string flag '?' ... for property debugDescription`(Objective-C runtime 固有噪音,与升级无关)。
其余 30 行分布在 2026-07-04 ~ 2026-08-07 的历史记录中。

⚠️ 仍未覆盖的路径:本次是**应用内「检查更新 → 下载 → 安装并重启」**全流程;`autoInstallOnAppQuit` 路径(退出时静默安装)
当前配置为 `false`,未涉及。

## 回退方法

`updater.ts` 把 `backend: withQuitIntent(autoUpdater, setQuitting)` 改回 `backend: autoUpdater`,删两个新文件即可(单点可逆)。
