// [fork-only] e2e-tauri-mac/fixtures — Mac Phase 2 真桌面 e2e fixture(GUI 黑盒,不连 WebView CDP)
// [feat: e2e-tauri-phase2-mac] 2026-05-28
//
// 跟 Win 端 fixtures.ts 对位关系:
// - Win 走 spawn(.exe) + WEBVIEW2 CDP + Playwright connectOverCDP + page.exposeFunction
// - Mac 走 spawn(.app/Contents/MacOS/DeskFox) + env DESKFOX_E2E_SAVE_PATH + osascript + cliclick
//
// 暴露 `deskfoxAppMac` fixture 给 specs 用,接口设计跟 Win 端 `deskfoxApp` 不同(没 page 对象),
// 但语义类似 — proc / saveDialog mock 路径 / 拉前景 / teardown 等核心 fixture 工序对齐。

import { test as base } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import {
  activateApp,
  quitApp,
  waitForAppLaunch,
  getWindowBoundsRetry,
  captureWindowArea,
  getFileSize,
  clickToFront,
  titleBarAnchor,
  type WindowBounds,
} from "./helpers"

// === 平台路径常量 ===

const REPO_ROOT = "/Volumes/ExtSSD/opencode-fork"
const DESKFOX_APP = `${REPO_ROOT}/packages/desktop/src-tauri/target/release/bundle/macos/DeskFox Dev.app`
const DESKFOX_BIN = `${DESKFOX_APP}/Contents/MacOS/DeskFox`

/** CFBundleName(dev override `productName: "DeskFox Dev"`)— osascript `tell application` 用 */
const APP_NAME = "DeskFox Dev"

/** binary basename(`mainBinaryName: "DeskFox"`)— `pgrep -f` / System Events process 名用 */
const PROCESS_NAME = "DeskFox"

/** e2e 测试专用项目目录 — 用 opencode-fork 本仓自身(稳定,docs/ + CLAUDE.md 等大量 .md) */
const E2E_PROJECT_DIR = REPO_ROOT

const E2E_OUTPUT_DIR = "/tmp/deskfox-e2e"

// === Fixture 类型 ===

export interface DeskFoxAppMac {
  /** spawn 出的子进程(.app binary)*/
  proc: ChildProcess
  /** CFBundleName,osascript `tell application` 用 */
  appName: string
  /** binary basename,pgrep / System Events 用 */
  processName: string
  /** spawn 时注入 DESKFOX_E2E_SAVE_PATH 的路径,saveDialog mock ② 返回该值 */
  e2eSavePath: string
  /** 本 feat 测试统一用的项目根 */
  projectDir: string

  /** 当前 frontmost window 位置 + 尺寸(每次调用重新查 osascript,应付窗口移动)*/
  windowBounds: () => Promise<WindowBounds>
  /**
   * 把窗口拉到前景。**实现走 cliclick 物理点击窗口标题**(osascript activate 异步不可靠,
   * 实测 macOS Sequoia 下 keystroke 会被打到 Terminal/IDE 等 frontmost app)。
   * 详 helpers/cliclick.ts clickToFront 注释。
   */
  activate: () => Promise<void>
  /** 强制立即退出(spec 内提前 abort 用;auto teardown 默认 quitApp → SIGKILL fallback)*/
  teardown: () => Promise<void>
}

type MacFixtures = {
  deskfoxAppMac: DeskFoxAppMac
}

// === Helper: 杀掉残留 dev 实例(精确匹配 .app 路径,不打 prod)===

async function killStaleDevInstances(): Promise<void> {
  // pkill -9 -f "DeskFox Dev.app" 命中 dev .app 子串(因为完整路径含 "DeskFox Dev.app"),
  // 不会撞 prod 的 /Applications/DeskFox.app(无 "Dev" 字样)。
  //
  // **重要**:DeskFox 主进程 + opencode-cli sidecar **同 .app 路径**都要杀干净。
  // pkill -f 模式匹配 process command line,只要含 "DeskFox Dev.app" 子串就命中两者。
  // 如果只杀主进程不杀 sidecar(早期 bug),sidecar 仍 listen 端口 → 新 .app spawn
  // 起来后 init 卡死 webview 不 hydrate(实测全量跑第一笔 fail 的真根因)。
  await new Promise<void>((resolve) => {
    const p = spawn("pkill", ["-9", "-f", "DeskFox Dev.app"], { stdio: "ignore" })
    p.on("close", () => resolve())
    p.on("error", () => resolve())
  })
  // 给 OS 时间清进程 + 释放端口 / state file 锁
  await new Promise((r) => setTimeout(r, 1500))
}

// === Fixture 主体 ===

export const test = base.extend<MacFixtures>({
  deskfoxAppMac: async ({}, use) => {
    // 0. 预检 — dev .app binary 必须存在
    if (!existsSync(DESKFOX_BIN)) {
      throw new Error(
        `DeskFox Dev.app 缺失:${DESKFOX_BIN}\n` +
          `先 build:bash packages/branding/scripts/build-deskfox.sh -Env dev`,
      )
    }
    mkdirSync(E2E_OUTPUT_DIR, { recursive: true })
    const e2eSavePath = `${E2E_OUTPUT_DIR}/mac-real-export-${Date.now()}.docx`

    // 1. 杀残留 dev 实例(防 multi-instance / 上一笔 teardown 没清干净)
    await killStaleDevInstances()

    // 2. spawn .app binary 带 env 注入 — saveDialog mock 方案 ② 入口
    //    注:Mac 端没有 WEBVIEW2 CDP 等价物,这里 env 只注入 saveDialog mock,不开远程 debug 端口
    console.log(`[fixtures-mac] spawning ${DESKFOX_BIN}`)
    console.log(`[fixtures-mac] saveDialog mock 路径:${e2eSavePath}`)
    const proc = spawn(DESKFOX_BIN, [], {
      env: {
        ...process.env,
        DESKFOX_E2E_SAVE_PATH: e2eSavePath,
      },
      stdio: "ignore",
      detached: false,
    })

    // 3. 等 .app launch 完成(进程出现 + 至少 1 个 window 可查 bounds)
    await waitForAppLaunch(APP_NAME, PROCESS_NAME, 30_000)
    console.log(`[fixtures-mac] ${APP_NAME} launched`)

    // 4. 拉前景(物理点击窗口标题)— **关键**:osascript activate 异步不可靠,
    //    实测 keystroke 会被 Terminal/IDE 截获;cliclick 物理点击是唯一稳路径。
    const initialBounds = await getWindowBoundsRetry(APP_NAME)
    const titleAnchor = titleBarAnchor(initialBounds)
    await clickToFront(titleAnchor.x, titleAnchor.y).catch((e) => {
      console.log(`[fixtures-mac] WARN clickToFront failed: ${e.message}`)
    })

    // 4.5 **deep_link 注入项目目录**(等价 Win 的 page.goto base64 URL)— 跟 Win 看齐的关键路径!
    //    `opencode://open-project?directory=<path>` 已注册到 Tauri deep_link plugin
    //    + layout.tsx handleDeepLinks 处理切项目。`open -a` 显式指定 .app 绕过 LaunchServices
    //    可能被 prod /Applications/DeskFox.app 抢占的默认 handler。
    //    [feat: e2e-tauri-phase2-mac] 2026-05-28
    const encodedUrl = `opencode://open-project?directory=${encodeURIComponent(E2E_PROJECT_DIR)}`
    console.log(`[fixtures-mac] 注入项目: ${encodedUrl}`)
    await new Promise<void>((resolve) => {
      const p = spawn("open", ["-a", DESKFOX_APP, encodedUrl], { stdio: "ignore" })
      p.on("close", () => resolve())
      p.on("error", () => resolve())
    })
    // 等项目视图切完 + 数据加载
    await new Promise((r) => setTimeout(r, 3000))

    // 5. 等 webview 真 hydrate — 关键修复
    //
    // 早期 fixture 用 `setTimeout(2500)` 等 hydrate,实测**冷启动 spawn(LaunchServices 无缓存
    // + sidecar npm install)后 20-40 秒都不够**:截屏 baseline 显示窗口出来但内容空白,
    // webview 还在加载 sidecar。
    //
    // 修法:poll captureWindowArea 看截屏 file size **从 splash 大小(~417KB)跳到 hydrated
    // 大小(≥ 480KB)**。具体阈值靠 verbose log 实测调。最多 60s 兜底。
    const bounds = await getWindowBoundsRetry(APP_NAME)
    const HYDRATE_TMP = `/tmp/deskfox-e2e/_hydrate-check-${Date.now()}.png`
    const HYDRATE_MIN_DELTA_FROM_SPLASH = 30_000 // 比 splash 大 ≥30KB 才算 hydrated
    const HYDRATE_TIMEOUT_MS = 30_000 // 30s 兜底
    const STABLE_PLATEAU_COUNT = 8 // splash size 连续 8 次稳定就 early exit(典型 raw spawn 不 hydrate 场景)
    const hydrateStart = Date.now()
    let splashSize = 0
    let lastSize = 0
    let plateauCount = 0
    const sizeHistory: number[] = []
    while (Date.now() - hydrateStart < HYDRATE_TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        await captureWindowArea(HYDRATE_TMP, bounds)
        const size = getFileSize(HYDRATE_TMP)
        sizeHistory.push(size)
        if (splashSize === 0) splashSize = size

        // 成功 hydrated:size 大 splash 至少 30KB 且连续 2 次稳定
        if (
          size - splashSize >= HYDRATE_MIN_DELTA_FROM_SPLASH &&
          Math.abs(size - lastSize) < 3_000
        ) {
          console.log(
            `[fixtures-mac] webview hydrated after ${Date.now() - hydrateStart}ms (size=${size}, splash=${splashSize})`,
          )
          console.log(`[fixtures-mac] size history: ${sizeHistory.join(", ")}`)
          break
        }
        // 早退条件:splash size 连续 N 次稳定 = 大概率不会 hydrate(踩坑 4 raw spawn 模式)
        if (Math.abs(size - lastSize) < 1_000) {
          plateauCount++
          if (plateauCount >= STABLE_PLATEAU_COUNT) {
            console.log(
              `[fixtures-mac] hydrate poll 早退 — splash size 稳定 ${plateauCount}s 不变(${size}) 大概率不 hydrate(踩坑 4 raw spawn)`,
            )
            break
          }
        } else {
          plateauCount = 0
        }
        lastSize = size
      } catch {
        // 截屏失败(窗口 transition),继续轮询
      }
    }
    if (Date.now() - hydrateStart >= HYDRATE_TIMEOUT_MS) {
      console.log(`[fixtures-mac] WARN hydrate poll 真超时 ${HYDRATE_TIMEOUT_MS}ms`)
      console.log(`[fixtures-mac] size history: ${sizeHistory.join(", ")}`)
    }

    const app: DeskFoxAppMac = {
      proc,
      appName: APP_NAME,
      processName: PROCESS_NAME,
      e2eSavePath,
      projectDir: E2E_PROJECT_DIR,
      windowBounds: () => getWindowBoundsRetry(APP_NAME),
      activate: async () => {
        // 物理点击窗口标题强制 frontmost,osascript activate 留作 fallback
        try {
          const b = await getWindowBoundsRetry(APP_NAME)
          const anchor = titleBarAnchor(b)
          await clickToFront(anchor.x, anchor.y)
        } catch (e) {
          console.log(`[fixtures-mac] clickToFront 失败,fallback osascript activate: ${e}`)
          await activateApp(APP_NAME)
        }
      },
      teardown: async () => {
        // 优先优雅退出(让 Tauri 走标准 CloseRequested 流程,sidecar 清理等)
        await quitApp(APP_NAME).catch(() => {
          // 优雅退出失败,SIGKILL
          if (!proc.killed) proc.kill("SIGKILL")
        })
        await new Promise((r) => setTimeout(r, 500))
      },
    }

    await use(app)

    // === Auto teardown ===
    // 三步杀干净:① osascript 优雅退出主进程 ② SIGKILL 主进程兜底 ③ pkill 同路径杀残留
    // sidecar(opencode-cli 是子进程,主进程退出 launchd 不一定连带杀,实测 :60093 等端口
    // 长期残留导致下一笔 fixture spawn 撞端口冲突 webview 不 hydrate)。
    try {
      await quitApp(APP_NAME).catch(() => undefined)
    } catch {
      // ignore
    }
    if (!proc.killed) {
      proc.kill("SIGKILL")
    }
    // 同 killStaleDevInstances 但用在 teardown,清完所有同 .app 路径子进程
    await new Promise<void>((resolve) => {
      const p = spawn("pkill", ["-9", "-f", "DeskFox Dev.app"], { stdio: "ignore" })
      p.on("close", () => resolve())
      p.on("error", () => resolve())
    })
    // 让 OS 释放端口 / 文件锁等
    await new Promise((r) => setTimeout(r, 1500))
  },
})

export { expect } from "@playwright/test"
