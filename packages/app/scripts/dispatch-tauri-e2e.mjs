#!/usr/bin/env node
// [fork-only] dispatch-tauri-e2e — 按 OS 平台 dispatch Phase 2 真桌面 e2e
// [feat: e2e-tauri-phase2-mac] 2026-05-28
//
// `bun run test:e2e:tauri` 统一入口,自动按 `process.platform` 分流到 -win / -mac script。
// 开发者也可显式 `bun run test:e2e:tauri-mac` / `-win` 强制平台。
//
// 设计原因:Mac / Win Phase 2 e2e 用不同 fixture 架构(CDP vs GUI 黑盒),
// 但治理层"跑 Phase 2 真桌面 e2e"该是单一动词,user 不需要记"我现在 Win 还是 Mac"。

import { execSync } from "node:child_process"
import { platform } from "node:process"

const script = platform === "darwin" ? "test:e2e:tauri-mac" : "test:e2e:tauri-win"
console.log(`[dispatch] platform=${platform} → bun run ${script}`)
try {
  execSync(`bun run ${script}`, { stdio: "inherit" })
} catch (e) {
  // 子进程 exit code 非 0 直接 propagate(playwright fail 时 exit 1)
  process.exit(e.status ?? 1)
}
