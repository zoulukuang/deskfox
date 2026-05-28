// FORK: Tauri 桌面 e2e Playwright config — connectOverCDP 路径 2026-05-07
//
// 路径选型:
//   wdio + tauri-driver + msedgedriver 路径试过,Tauri 2 + WebView2 + Win11 上不通
//   (msedgedriver 启的是 isolated empty WebView2,不接管 DeskFox)。
//   改用 Playwright connectOverCDP 直接连 DeskFox 启动时开的 9222 远程调试端口。

import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./specs",
  outputDir: "./test-results",
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false, // 桌面 app 单实例
  workers: 1,
  retries: 0,
  reporter: [["list"]],

  // 没有 webServer — 测试自管理 DeskFox.exe 子进程
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "tauri-cdp",
      use: {
        // 连 9222 — DeskFox 启动时 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env 开
      },
    },
  ],
})
