import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/HiddenTerminalRegression"
const projectID = "proj_hidden_terminal_regression"
const sessionID = "ses_hidden_terminal_regression"
const title = "Hidden terminal regression"

test("unmounts the terminal panel while it is hidden", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "hidden-terminal-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "hidden-terminal-regression",
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/api/pty*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { directory, project: { id: projectID, directory } },
        data: {
          id: "pty_hidden_terminal",
          title: "Terminal 1",
          command: "cmd.exe",
          args: [],
          cwd: directory,
          status: "running",
          pid: 1,
        },
      }),
    }),
  )
  await page.route("**/api/pty/pty_hidden_terminal*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { directory, project: { id: projectID, directory } },
        data: {
          id: "pty_hidden_terminal",
          title: "Terminal 1",
          command: "cmd.exe",
          args: [],
          cwd: directory,
          status: "running",
          pid: 1,
        },
      }),
    }),
  )
  await page.route("**/api/pty/pty_hidden_terminal/connect-token*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        location: { directory, project: { id: projectID, directory } },
        data: { ticket: "e2e-ticket", expires_in: 60 },
      }),
    }),
  )
  await page.routeWebSocket("**/api/pty/pty_hidden_terminal/connect", () => undefined)

  // FORK: 本 spec v1.18.4 起断言 v2 终端语义(关闭即卸载);上游靠 v2 默认,DeskFox e2e 基线
  //   为经典布局(mock-server 种子),此处显式开 v2。2026-08-11 [feat: upstream-sync-2026-08]
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  await page.keyboard.press("Control+Backquote")
  const panel = page.locator("#terminal-panel")
  await expect(panel).toHaveAttribute("aria-hidden", "false")
  await expect(page.locator('[data-component="terminal"]')).toBeVisible()

  await page.keyboard.press("Control+Backquote")
  await expect(panel).toHaveCount(0)
  await expect(page.locator('[data-component="terminal"]')).toHaveCount(0)

  await page.setViewportSize({ width: 1200, height: 700 })
  await expect(page.locator('[data-component="terminal"]')).toHaveCount(0)

  await page.keyboard.press("Control+Backquote")
  await expect(panel).toBeVisible()
  await expect(page.locator('[data-component="terminal"]')).toBeVisible()
})

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
