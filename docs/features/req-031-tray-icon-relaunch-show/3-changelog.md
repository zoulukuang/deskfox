---
feat-id: req-031-tray-icon-relaunch-show
status: done
related: ./3-changelog.md
---

# 3-changelog · REQ-031 关闭到托盘后点桌面/程序图标重开窗口

## 现象

DeskFox GUI 关闭后会 hide 到系统托盘常驻(飞书 adapter 等长驻进程不退)。但用户**再次从桌面图标 / Dock / Finder / 程序列表点 DeskFox 启动 → 没反应**(窗口还隐藏),期望应该唤回。

## 根因

`packages/desktop/src-tauri/src/lib.rs:454-459` 的 `tauri_plugin_single_instance` 回调原实现:

```rust
if let Some(window) = app.get_webview_window(MainWindow::LABEL) {
    let _ = window.set_focus();
    let _ = window.unminimize();
}
```

只 `set_focus` + `unminimize` —— 对被 `hide()` 的窗口**无效**(看不见就 focus 不到,unminimize 也不会让 hidden 窗口可见)。

而 `system_tray.rs` 里 tray 菜单"打开 DeskFox"+ 左键单击共用的 `show_main_window_impl` helper 顺序正确:`show() → unminimize() → set_focus()`(被 hide 的必须先 show)。两条唤出路径行为不一致。

## 修法

最小改动 + 单一来源:把 `system_tray::show_main_window_impl` 改 `pub`,lib.rs single-instance 回调复用之,与 tray 菜单"打开 DeskFox"行为完全对齐。

## 改动文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/desktop/src-tauri/src/system_tray.rs` | `fn show_main_window_impl` → `pub fn`(+ 顺序说明注释) | ~2 |
| `packages/desktop/src-tauri/src/lib.rs` | single-instance 回调改调 `system_tray::show_main_window_impl(app)`(+ FORK 注释解释 hide vs unminimize 的区别) | ~6 |

净改动 ~8 行,纯桌面入口注入,0 上游 TS 改动,0 R4 override。

## 测试 / 验证

- `cargo check`:exit 0,无新 warning(余警告均 `logging.rs::tail` 等既有)。
- 自动化:single-instance 回调是 OS 二次启动行为,Tauri runtime 难单测;e2e 基础设施(Phase 1)未 ready,**留 user 真桌面抽查**(spec 也标 🟡 自动 + 人工抽查)。
- 人工抽查路径(交付前由 user 测):
  1. 启动 DeskFox,关 GUI → 应进托盘常驻(原行为不变)
  2. 点桌面/Dock/程序列表 DeskFox 图标 → **窗口重新唤出 + 聚焦**(本修)
  3. 同时跑两遍 tray 菜单"打开 DeskFox" → 行为应与 #2 完全一致

## 影响范围 / 健康指标

- 上游侵入:0 新增改上游文件(`lib.rs` / `system_tray.rs` 本就在 fork 改动集内)。
- override:0。
- 回退:`git revert` 本 commit 即可。

## 关键术语

system tray, tauri_plugin_single_instance, window.show, set_focus, unminimize, hide, CloseRequested, 关闭到托盘, 重开窗口, desktop icon relaunch, 二次启动, show_main_window_impl
