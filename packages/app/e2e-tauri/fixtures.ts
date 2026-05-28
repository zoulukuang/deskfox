// FORK: Tauri 桌面 e2e fixture — spawn DeskFox.exe + connectOverCDP 2026-05-07

import { spawn, exec, type ChildProcess } from "node:child_process"
import { mkdirSync } from "node:fs"
import { promisify } from "node:util"
import { test as base, chromium, type Page, type BrowserContext, type Browser } from "@playwright/test"

const execP = promisify(exec)

const DESKFOX_EXE = "D:/project/opencode-fork/packages/desktop/src-tauri/target/release/DeskFox.exe"
const CDP_PORT = 9222
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`

// E2E 测试专用项目目录 — 用 opencode-fork 本仓自身(稳定,docs/features/ + CLAUDE.md 等大量 .md,user 机器肯定有)
// 2026-05-28 改:从 Downloads 改本仓,Downloads 在 user 机器可能没 .md
const E2E_PROJECT_DIR = "D:/project/opencode-fork"

async function waitForCdp(maxMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${CDP_URL}/json/version`)
      if (res.ok) return
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`CDP at ${CDP_URL} did not come up within ${maxMs}ms`)
}

type TauriFixtures = {
  deskfoxApp: {
    proc: ChildProcess
    browser: Browser
    context: BrowserContext
    page: Page
    /** ⚠ 占位字段 — 等 saveDialog mock 方案落地后填值并启用 md-to-word-real.spec.ts(目前 fixme)*/
    e2eSavePath: string
  }
}

/** 把 DeskFox 主窗口拉到前景(Playwright spawn 默认不抢焦点)*/
async function bringDeskfoxToForeground(): Promise<void> {
  const psScript = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n); }' -ErrorAction SilentlyContinue
$d = Get-Process DeskFox -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($d) {
  [W]::ShowWindow($d.MainWindowHandle, 9) | Out-Null
  [W]::SetForegroundWindow($d.MainWindowHandle) | Out-Null
}
`.trim()
  await execP(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, "; ")}"`)
}

export const test = base.extend<TauriFixtures>({
  deskfoxApp: async ({}, use) => {
    // 1. spawn DeskFox.exe with remote debugging
    const proc = spawn(DESKFOX_EXE, [], {
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
      },
      stdio: "ignore",
      detached: false,
    })

    // 2. wait CDP ready
    await waitForCdp()

    // 3. connect Playwright over CDP
    const browser = await chromium.connectOverCDP(CDP_URL)
    const context = browser.contexts()[0]
    if (!context) throw new Error("No browser context found via CDP")
    let page = context.pages()[0]
    if (!page) {
      page = await context.waitForEvent("page", { timeout: 10_000 })
    }

    // 4. **saveDialog mock 注入(方案 ①)** — 在任何 export 动作前 expose mock 函数。
    //    生产环境 window.__deskFoxE2eSavePath 永远 undefined,DeskFox 平台 saveFilePickerDialog
    //    fall through 走真 native dialog;测试态时本函数被调用,返 mock 路径让产品代码以为 user 选了文件。
    //    [feat: e2e-tauri-phase2-real-desktop] 2026-05-28
    const E2E_OUTPUT_DIR = "D:/tmp/deskfox-test-output"
    mkdirSync(E2E_OUTPUT_DIR, { recursive: true })
    const e2eSavePath = `${E2E_OUTPUT_DIR}/e2e-real-export-${Date.now()}.docx`
    await page.exposeFunction("__deskFoxE2eSavePath", () => e2eSavePath)
    console.log(`[fixtures] saveDialog mock 注入 — 将返 ${e2eSavePath}`)

    // 5. SolidJS hydrate — 等 splash 退出 + UI element 出现
    await page.waitForLoadState("domcontentloaded")
    await page.waitForSelector("button", { timeout: 30_000, state: "visible" }).catch(() => {
      console.log("[fixtures] WARN: no button visible after 30s — UI may not have hydrated")
    })
    await page.waitForTimeout(1500)

    // 6. **强制注入 E2E 项目** — 用 router 直接跳到本仓根(每次启动统一环境,不靠 user state)
    // DeskFox 路径编码用 base64(实测路由 /<base64-path>,如 `RDpc5paH56ug5bqT` = `D:\文章库`),不是 URI encode
    const encodedDir = Buffer.from(E2E_PROJECT_DIR, "utf8").toString("base64")
    const projectUrl = `http://tauri.localhost/${encodedDir}`
    console.log(`[fixtures] navigating to E2E project: ${projectUrl}`)
    await page.goto(projectUrl, { waitUntil: "domcontentloaded" })
    // 等项目文件树 / 内容渲染
    await page.waitForTimeout(3000)

    // 7. 把 DeskFox 主窗口拉到前景(让 user 能看见 e2e 测试过程)
    await bringDeskfoxToForeground().catch((e) => {
      console.log(`[fixtures] WARN: SetForegroundWindow failed: ${e.message}`)
    })

    await use({ proc, browser, context, page, e2eSavePath })

    // teardown
    try {
      await browser.close()
    } catch {
      // ignore
    }
    if (!proc.killed) {
      proc.kill("SIGKILL")
    }
    await new Promise((r) => setTimeout(r, 500)) // 让 Win 释放端口
  },
})

export { expect } from "@playwright/test"
