feat-id: window-resizable
status: done
related: ./3-changelog.md

# 3-changelog · 窗口可鼠标拖拽改大小(Tiny)

> Tiny(配置/原生窗口行为,~8 行 / 2 文件)→ 按规范只写本 changelog。

## 问题

DeskFox 窗口无法用鼠标拖边改大小,开局铺满整屏(连任务栏都盖住)。2026-05-27 user 报。

## 根因

`tauri-plugin-window-state` 持久化并每次启动恢复窗口状态(flags 含 MAXIMIZED + FULLSCREEN)。残留 `.window-state.json` 里 `"fullscreen": true` 被反复恢复 → 窗口钉死全显示器尺寸、四边在屏外、抓不到边拖。代码无任何显式 set_fullscreen(grep 全 src 确认),全屏纯来自状态恢复。builder 的 `.maximized(true)` 只是首次默认,会被插件恢复盖过。

## 改动(commit 44180a261)

- `packages/desktop/src-tauri/src/constants.rs` `window_state_flags()`:减掉 `MAXIMIZED` + `FULLSCREEN`(`all() - DECORATIONS - VISIBLE - MAXIMIZED - FULLSCREEN`)→ 全屏/最大化不再跨会话持久(尺寸/位置仍记忆,防卡死复发)。
- `packages/desktop/src-tauri/src/windows.rs` main 窗口:去 `.maximized(true)`,改 `.resizable(true) + .min_inner_size(800,600) + .inner_size(1280,800) + .center()` → 开局窗口态。
- 配套清一次残留 `.window-state.json`(只去 flag 不删文件无效,旧 SIZE 仍恢复满屏)。
- 两处均上游文件,已加 FORK marker。

## 测试 / 回归

native 拖拽手感无法 CDP/单测 → R5 native/配置例外。CDP 仅确认窗口开成 1280×800 窗口态(winInner=[1280,800] vs screenAvail=[2560,1392]);**user 真桌面实测确认可拖拽、修好**(2026-05-27)。

## 回退

revert 44180a261 即恢复原最大化开局行为。详见记忆 `reference_tauri_window_fullscreen_state_trap`。
