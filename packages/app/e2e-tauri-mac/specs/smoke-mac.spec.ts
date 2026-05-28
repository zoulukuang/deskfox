// [fork-only] smoke-mac.spec — Mac Phase 2 真桌面 e2e smoke
// [feat: e2e-tauri-phase2-mac] 2026-05-28
//
// 跟 Win 端 smoke-cdp.spec.ts 对位 — 验"链路通"(.app 启动 / 窗口可见 / 至少能 screencapture 出非空白)。
// **不验业务**(那是 md-to-word-real-mac 的范围)。
//
// 这是 Mac 端 Phase 2 e2e 的 hello-world,跑通它就证明:
//   1. .app spawn 后能起 GUI
//   2. osascript 拉前景生效
//   3. window bounds 查询通(辅助功能权限授予正确)
//   4. screencapture 能截到非空白(WebView 真 hydrate 出来,不是黑屏)
//   5. fixture 的 teardown 流程闭环不漏进程

import { test, expect } from "../fixtures"
import { takeFullScreen, captureWindowArea, getFileSize } from "../helpers"
import { join } from "node:path"

const OUT_DIR = "/tmp/deskfox-e2e/smoke"

test.describe("smoke-mac — Mac Phase 2 真桌面 e2e 链路", () => {
  test("#1 .app 启动 + 窗口可查 + 截屏非空白", async ({ deskfoxAppMac }) => {
    // 1. window bounds 查询通(辅助功能权限验证)
    const bounds = await deskfoxAppMac.windowBounds()
    expect(bounds.width).toBeGreaterThan(400)
    expect(bounds.height).toBeGreaterThan(300)
    console.log(`[smoke] window bounds: ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`)

    // 2. 全屏截图(应当含 DeskFox 窗口)
    const ts = Date.now()
    const fullPath = join(OUT_DIR, `full-${ts}.png`)
    await takeFullScreen(fullPath)
    const fullSize = getFileSize(fullPath)
    expect(fullSize).toBeGreaterThan(50_000) // 50KB+ 才有内容(标准 .png 全黑 < 5KB)
    console.log(`[smoke] full screen ${fullSize} bytes -> ${fullPath}`)

    // 3. 窗口区域截图(跟 Win 端 page.screenshot 对位)
    const windowPath = join(OUT_DIR, `window-${ts}.png`)
    await captureWindowArea(windowPath, bounds)
    const windowSize = getFileSize(windowPath)
    expect(windowSize).toBeGreaterThan(20_000) // 窗口子区域至少 20KB 内容
    console.log(`[smoke] window area ${windowSize} bytes -> ${windowPath}`)

    // 4. saveDialog mock env 注入路径正确性(只验路径串,不真触发导出)
    expect(deskfoxAppMac.e2eSavePath).toMatch(/^\/tmp\/deskfox-e2e\/mac-real-export-\d+\.docx$/)

    // 5. fixture teardown 闭环靠 use 返回时自动跑
  })

  test("#2 二次启动 — fixture 串行下能反复 spawn", async ({ deskfoxAppMac }) => {
    // 单测 fixture 多次起停的稳定性(workers=1 串行,本测试是连续第二个;
    // 验 killStaleDevInstances + spawn 多轮无残留)
    const bounds = await deskfoxAppMac.windowBounds()
    expect(bounds.width).toBeGreaterThan(400)

    const fullPath = join(OUT_DIR, `relaunch-${Date.now()}.png`)
    await takeFullScreen(fullPath)
    expect(getFileSize(fullPath)).toBeGreaterThan(50_000)
  })
})
