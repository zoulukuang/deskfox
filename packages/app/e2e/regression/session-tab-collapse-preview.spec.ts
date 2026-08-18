// FORK-ONLY: REQ-111 点顶部当前文件 tab 收起预览器 [feat: session-presentation-input-batch] 2026-08-17
//
// 两条都要:
//   ① 点「已激活的那个」文件 tab → 预览器收起,再点该文件 → 重新展开;
//   ② 🔒 切换到**别的** tab 绝不能把面板收掉 —— Kobalte 的 Tabs.Trigger 在 pointerdown 就切激活态,
//      「当前激活是谁」的快照取晚一步(mousedown 都算晚)就会每次切 tab 都误收。实测踩过。
import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/TabCollapse"
const projectID = "proj_tab_collapse"
const sessionID = "ses_tab_collapse"
const title = "Tab collapse"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const files = ["alpha.ts", "beta.ts"]

test.use({ viewport: { width: 1440, height: 900 } })

test("点已激活的文件 tab → 预览器收起", async ({ page }) => {
  await setup(page)
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  const panel = page.locator("#review-panel")
  await panel.getByRole("button", { name: "Open file" }).click()
  await panel.getByRole("button", { name: "alpha.ts" }).dblclick()
  await expect(panel.getByRole("tab", { name: "alpha.ts" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("contents:alpha.ts", { exact: true })).toBeVisible()

  await panel.getByRole("tab", { name: "alpha.ts" }).click()
  await expect(panel.getByText("contents:alpha.ts", { exact: true })).toBeHidden()
  // 收起后连 tab 条本身也不可达 —— 这正是"整块预览器收起"的定义
  await expect(panel.getByRole("tab", { name: "alpha.ts" })).toBeHidden()
  // 重新展开走面板**外部**入口(文件树/命令),不在本用例覆盖范围;见 3-changelog 的 🔒 真机清单
})

test("🔒 切换到别的 tab 不会把面板收掉(快照必须在 pointerdown 捕获阶段取)", async ({ page }) => {
  await setup(page)
  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)

  const panel = page.locator("#review-panel")
  await panel.getByRole("button", { name: "Open file" }).click()
  await panel.getByRole("button", { name: "alpha.ts" }).dblclick()
  await panel.getByRole("button", { name: "Open file" }).click()
  await panel.getByRole("button", { name: "beta.ts" }).dblclick()
  await expect(panel.getByText("contents:beta.ts", { exact: true })).toBeVisible()

  // 从 beta 切回 alpha:这是「切 tab」不是「再次点击」,面板必须还在
  await panel.getByRole("tab", { name: "alpha.ts" }).click()
  await expect(panel.getByText("contents:alpha.ts", { exact: true })).toBeVisible()
})

async function setup(page: Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "tab-collapse",
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
        slug: sessionID,
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    vcsDiff: [],
    fileList: (path) => {
      if (path) return []
      return files.map((name) => ({
        name,
        path: name,
        absolute: `${directory}/${name}`,
        type: "file" as const,
        ignored: false,
      }))
    },
    fileContent: (path) => ({ type: "text", content: `contents:${path}` }),
    pageMessages: () => ({ items: [] }),
  })

  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.global.dat:layout",
        JSON.stringify({ review: { diffStyle: "split", panelOpened: true } }),
      )
      localStorage.setItem(
        "opencode.global.dat:review-panel-v2",
        JSON.stringify({ sidebarOpened: true, sidebarWidth: 240, expandMode: "collapse" }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
      )
    },
    { directory, server, sessionID },
  )
}
