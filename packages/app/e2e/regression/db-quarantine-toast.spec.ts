// FORK: REQ-084① 数据库被隔离后向用户说明去向 —— renderer 侧 happy path
//   [feat: voice-preclear-batch] 2026-08-18
//
// 为什么要有这条:S1 的决策逻辑(`utils/db-quarantine-notice.ts`)有单测、主进程侧四个模块也有单测,
// 但**「主进程说 db 被隔离了 → 用户真的看见一条解释 toast」这条链路只有真机脚本验过**
// (`packages/branding/smoke/req084_toast_verify.py`,需要造超前 db、手动跑)。
// 真机脚本是验收证据,不是回归网 —— 它不进 pre-push、不进默认套件,renderer 侧一旦被改坏没人拦。
// 按 R5 决策 1(Medium feat ≥ 1 e2e happy path)补这条自动化的。
//
// 桌面桥说明:`DbQuarantineMonitor` 只在 `isDesktopApp()`(= `window.deskfox` 存在)时工作,
// web 模式下直接 return。所以这里注入一个最小 `window.deskfox`,让 renderer 走真实分支。
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { makeProject, makeProvider, makeSession } from "../utils/fixtures"

const directory = "C:/OpenCode/DbQuarantineToast"
const projectID = "proj_db_quarantine_toast"
const sessionID = "ses_db_quarantine_toast"
const title = "DB quarantine toast regression"

type Notice = { kind: "migrate" | "startup"; dbNames: string[]; dir?: string } | null

async function setupPage(page: Page, notice: Notice) {
  await page.addInitScript((injected) => {
    const bridge = {
      invoke: (cmd: string) => {
        if (cmd === "get_db_quarantine_notice") return Promise.resolve(injected)
        return Promise.resolve(null)
      },
      listen: () => Promise.resolve(() => {}),
    }
    Object.defineProperty(window, "deskfox", { value: bridge, configurable: true })
  }, notice)

  await mockOpenCodeServer(page, {
    directory,
    project: makeProject({ id: projectID, directory, name: title }),
    provider: makeProvider(),
    sessions: [makeSession({ id: sessionID, projectID, directory, title })],
    pageMessages: () => ({ items: [] }),
    events: () => [],
  })
}

function toastText(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-component="toast"],.toast-v2-region .toast-v2')]
      .map((element) => element.textContent ?? "")
      .join("\n"),
  )
}

async function waitForToast(page: Page) {
  await page.waitForFunction(
    () => document.querySelectorAll('[data-component="toast"],.toast-v2-region .toast-v2').length >= 1,
    { timeout: 20_000 },
  )
}

test.describe("regression: REQ-084① db quarantine toast", () => {
  test("startup quarantine tells the user where the database went", async ({ page }) => {
    await setupPage(page, {
      kind: "startup",
      dbNames: ["opencode.db"],
      dir: "/Users/tester/Library/Application Support/deskfox",
    })
    await page.goto("/")
    await waitForToast(page)

    const text = await toastText(page)
    // 三件事缺一不可:发生了什么 / 数据没被删 / 去哪找
    expect(text).toContain("已另存备份")
    expect(text).toContain("文件没有被删除")
    expect(text).toContain("/Users/tester/Library/Application Support/deskfox")
  })

  test("migrate-phase quarantine says config still migrated and the original file stays put", async ({ page }) => {
    await setupPage(page, { kind: "migrate", dbNames: ["opencode.db"] })
    await page.goto("/")
    await waitForToast(page)

    const text = await toastText(page)
    expect(text).toContain("未迁入")
    expect(text).toContain("账号与配置已正常迁入")
    expect(text).toContain("原文件已保留")
  })

  test("no notice means no toast at all", async ({ page }) => {
    await setupPage(page, null)
    await page.goto("/")
    await page.waitForSelector("main", { timeout: 20_000 })
    // 给 onMount 的 invoke 一点时间,确认它**不会**弹出任何东西
    await page.waitForTimeout(1_000)
    expect(await toastText(page)).toBe("")
  })
})
