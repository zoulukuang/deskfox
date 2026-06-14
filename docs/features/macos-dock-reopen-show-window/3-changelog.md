---
feat-id: macos-dock-reopen-show-window
status: done
related: ./3-changelog.md
---

# 3-changelog — macos-dock-reopen-show-window

> Tiny 规模(Rust 1 文件 ~9 行,接力 req-031 补 Mac Dock 漏网路径),按规范只写 3-changelog.md。

## 背景 / 现象

DeskFox 主窗口关闭(实为 hide 到后台,主进程仍跑)后,在 macOS 上:
- 点 **菜单栏托盘图标**(狐狸)→ 主窗口正常打开 ✅
- 点 **Dock 程序坞图标**(狐狸)→ 主窗口**打不开** ❌

## 根因

三条「重开主窗口」路径在 macOS 上走**不同事件**:

| 入口 | 事件 | req-031 是否覆盖 |
|---|---|---|
| 托盘左键单击 / 菜单「打开」 | `TrayIconEvent` | ✅ 调 `show_main_window_impl` |
| 二次启动 app(再点一次未运行的 exe) | `single-instance` 插件回调 | ✅ req-031 加的 |
| **Dock 图标点击(app 已运行)** | **`RunEvent::Reopen`(macOS 专有)** | ❌ **漏** |

`req-031-tray-icon-relaunch-show`(2026-05-28)把 `show_main_window_impl` 改 pub 并接到 tray + single-instance 两条路径,但 **Dock 点击 app-already-running 时触发的是 `RunEvent::Reopen`**(macOS `applicationShouldHandleReopen` 的 Tauri 封装),`lib.rs` 的 `.run(|app, event| match &event {...})` 只处理了 `Exit` / `WindowEvent`,没有 `Reopen` arm → 落到 `_ => {}` 被忽略,主窗口保持 hidden。

## 修法

`packages/desktop/src-tauri/src/lib.rs` 的 RunEvent match 加一条 macOS-gated arm:

```rust
#[cfg(target_os = "macos")]
RunEvent::Reopen { .. } => {
    tracing::debug!("dock reopen → show main window");
    system_tray::show_main_window_impl(app);
}
```

- **复用** `show_main_window_impl`(幂等:show → unminimize → set_focus),跟 tray 左键单击同一恢复入口,行为一致;
- **`#[cfg(target_os = "macos")]` 必需**:`RunEvent::Reopen` 是 macOS-only 变体,Win 编译时该变体不存在,不 gate 会编译失败;Win 走 `_ => {}` 不受影响;
- 无条件 show(不看 `has_visible_windows`):点 Dock 永远把主窗口拿到前台,符合 user 直觉,幂等无副作用。

## 验证

- `cargo check`(macOS target)**通过**(仅预存 unused warnings,与本改无关)。
- ⚠️ **真机 QA 验收**:关主窗口 → 点 Dock 图标 → 主窗口重现。Native Dock 事件 GUI 无法单测(同 req-031「CDP 自测 ≠ 真桌面 QA」+ R5 native 例外)。
- Win 端不受影响(arm 被 cfg 排除);Win Dock 等价行为本就由 single-instance 覆盖。

## 规模 / 影响

- **Tiny**:1 文件(`lib.rs`)~9 行(含注释),fork-only 改动(已有 FORK 注释密集区,加 marker)。
- **回退**:`git revert` 本 commit;恢复后仅「Mac Dock 点击不重开窗口」回归。
- **0 改上游产品逻辑(lib.rs 为 fork 主程序)/ 0 R4 override / 0 黑名单**。
- [bug-repro: macOS 主窗口关闭后点 Dock 图标主窗口不重开 — RunEvent::Reopen 未处理,GUI 无法单测以真机 QA 验收]

## Electron 换基座平移补全(2026-06-14)

`feat/electron-replatform` 换基座后,本 Tauri 修法**未随之平移**到 Electron 主程序 →
回归(关主窗口 hide 到托盘后,点 Dock 图标主窗口不重现;托盘左键/菜单仍正常)。

- **根因**:Electron 的 Dock-reopen 入口是 `app.on("activate")`(macOS `applicationShouldHandleReopen` 的 Electron 封装,对应 Tauri `RunEvent::Reopen`)。`packages/desktop/src/main/index.ts` 注册了 `second-instance`/`open-url`/`window-all-closed` 等,**独缺 `activate`** → 落空,主窗口保持 hidden。
- **修法**(`packages/desktop/src/main/index.ts`,fork-only ~3 行 + 注释):`app.on("activate", () => showMainWindow())`。复用 tray.ts 已导出的 `showMainWindow`(`restore→show→focus`,幂等),与托盘左键单击/`second-instance` 同一恢复入口,行为一致。`activate` 是 macOS-only 事件(Win 不触发),无需平台 gate。
- **验证**:`bun run typecheck`(desktop)通过;`bun test`(desktop)87 pass / 0 fail(无新单测 —— native Dock 事件 GUI 无法单测,同 Tauri 版 R5 native 例外,靠真机 QA)。⚠️ 真机 QA:关主窗口 → 点 Dock 狐狸图标 → 主窗口重现。
- [bug-repro: 换基座后 macOS Dock 点击不重开主窗口 — Electron app.on("activate") 未注册,GUI 无法单测以真机 QA 验收]
