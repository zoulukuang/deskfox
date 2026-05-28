// [fork-only] e2e-tauri-mac playwright config — Mac Phase 2 真桌面 e2e
// [feat: e2e-tauri-phase2-mac] 2026-05-28
//
// 跟 Win 端 playwright-tauri.ts 区别:
// - testDir 指向 ./specs(本目录)
// - workers=1 + fullyParallel=false:GUI 黑盒模拟只有一个 front window,必须串行
// - timeout 180s/case:Mac .app spawn + waitForAppLaunch + 模拟交互比 CDP 慢
// - reporter 走 list + html,跟 Win 对齐

import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./report", open: "never" }],
  ],
  outputDir: "./test-results",
})
