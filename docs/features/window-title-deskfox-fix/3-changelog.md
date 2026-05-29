---
feat-id: window-title-deskfox-fix
status: done
related: ./3-changelog.md
---

# 3-changelog — 主窗口标题品牌泄漏修复

**2026-05-29 / Tiny / 1 文件 / 3 行净增**

## 背景

Smoke 测试发现 `DeskFox.exe` 主窗口标题显示 `OpenCode`(上游硬编码),而 productName / installer / bundle identifier 都已经按 env 走 `tauri-overrides` 注入 DeskFox 品牌字符串了 — 唯独 Rust 那边窗口 builder 没读 productName,自己写了字面量。

## 改动

`packages/desktop/src-tauri/src/windows.rs:56` `MainWindow::create`:

```diff
-        .title("OpenCode")
+        // FORK: 窗口标题读 productName(tauri-overrides 按 env 注入 ...),修复品牌泄漏。
+        .title(app.config().product_name.clone().unwrap_or_else(|| "DeskFox".to_string()))
```

同文件 line 170 的 `base_window_config` 已经在用 `_app.config().product_name` 决定 data_directory,API 兼容,沿用即可。LoadingWindow 没显式 `.title()` 调用,Tauri 默认就拿 productName,无需改。

## 验证

- typecheck 17/17 pass(merge 前在 main 上已跑)
- Rust release build 1m6s 增量(只编 windows.rs)
- 启动 `DeskFox.exe -Env dev`,`Get-Process DeskFox` 看 `MainWindowTitle`:**`DeskFox Dev`**(此前是 `OpenCode`)

## 影响范围

- dev channel:`DeskFox Dev`
- beta channel:`DeskFox Beta`
- prod channel:`DeskFox`

三档自动从 `packages/branding/tauri-overrides/{dev,beta,prod}.json` 的 `productName` 字段取,跟 installer 一致。

## 回退

`git revert` 本 commit,或单点把 line 56 改回 `.title("OpenCode")`。

## 规范对照

- R1 三级跳:无法新文件做(必须改上游 builder 链),原地改 1 行 — 健康
- R2 FORK marker:已加 2 行单点注释
- R3 品牌:间接走 tauri-overrides productName(没引入新 override 路径)
- R4 黑名单:`packages/desktop/src-tauri/src/` 在白名单(规则 §4.1),不触 override
- R5 测试:Tiny <50 行 / 1 文件 / bug fix,豁免新测试要求;启动验证 = 视觉确认
