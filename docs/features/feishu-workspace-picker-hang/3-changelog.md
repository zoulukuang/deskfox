---
feat-id: feishu-workspace-picker-hang
status: done
related: ./3-changelog.md
---

# 3-changelog — feishu-workspace-picker-hang

> Tiny 规模(1 Rust 文件 / ~25 净行 / fork-only),按规范只写 3-changelog.md。

## 现象

飞书桥接绑定页 → 对账号点「编辑」→ 工作目录块点「选择」→ **原生文件夹选择器第一步就卡死**:panel 弹出但全程点不动,连 Cancel / Open 都失效,整个 DeskFox 窗口被模态挡住像彻底死机。

## 诊断过程(关键,留作复用)

逐层排除,实证「不是 DeskFox 进程崩/死循环」:
- `ps` + `sample`:DeskFox 主进程主线程停在**正常 tao 事件循环**(`NSApplication run` → `_DPSNextEvent`,空闲),WebContent JS 线程也空闲,sidecar 健康响应(401)、本次启动 **0 次看门狗重启** → 跟 macos-monterey / coldstart-toast 两笔都无关。
- 卡的是 macOS **系统文件面板**(out-of-process `openAndSavePanelService` / ViewBridge):panel 弹出到塞满大图(2000×2000 等)+ 111 项子文件夹的 Downloads,图标视图触发系统缩略图服务卡顿;叠加整机 CPU 被占(WindowServer 34% + 其它)→ panel 点击响应被饿死。
- 根因代码:`feishu_adapter.rs::feishu_pick_workspace_dir`(`feishu-account-workspace` 2026-06-07 引入),`#[tauri::command]` 同步 fn 直接 `blocking_pick_folder`,无 `set_parent`,且注释假设「同步命令跑 worker 线程」(脆弱)。

## 修法(`feishu_adapter.rs` 一处)

三处加固:

| 加固 | 作用 |
|---|---|
| 命令 `fn` → `async fn` + `tauri::async_runtime::spawn_blocking` | 保证 `blocking_pick_folder` **离开 main 线程**(其文档明确禁 main 线程调),不再依赖"同步命令在 worker"这一脆弱假设 |
| `.set_parent(主窗口)` | 自由浮动 app-modal panel → 挂主窗口的 **document-modal sheet**,事件由主窗口模态会话统一处理(macOS 上自由浮动 panel 易丢事件 / 模态异常) |
| `.set_directory(home)` | 默认开到用户主目录,避开 panel 记忆的上次目录(塞满大图的 Downloads → 缩略图服务卡顿,正是"第一步就卡"的高发诱因) |

配套加 `use crate::windows::MainWindow;`(取 `MainWindow::LABEL` = `"main"` 做 `get_webview_window` 拿父窗口)。前端 0 改动(`invoke("feishu_pick_workspace_dir")` 对 async 命令一样)。

## 验证

- `cargo check` 通过(仅既有 warning,0 error)。
- **真机点验通过**(user 实测):重 build dev 包后,飞书绑定页 → 编辑 → 选工作目录,对话框正常弹出为 sheet、默认开到 home、可正常 Cancel / 进目录 / Open,**不再卡死**。
- 原生对话框行为无法单测(GUI),按治理「CDP 自测 ≠ 真桌面 QA」+ R5 原生对话框例外,以真机 QA 为验收。

## 规模 / 影响

- **Tiny**:`feishu_adapter.rs` 1 文件 / ~25 净行 / 纯 fork-only(本就是 fork 自加的飞书命令)。
- **回退**:`git revert` 本 commit。
- **0 改上游 / 0 R4 / 0 黑名单**。
- [bug-repro: 飞书"选工作目录"原生 picker 第一步卡死 — blocking_pick_folder 无 set_parent + 线程假设脆弱 + 默认开到重图目录;无自动化(GUI),以真机 QA 验收]
