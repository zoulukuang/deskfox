// FORK-ONLY e2e: REQ-096 会话列表操作体验 — 标题 blur 保存 / 行右键菜单 / 归档撤销 / 图标移除
// [feat: session-list-ux]
import { expect, test, type Page, type Request } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture, pageMessages } from "./session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

async function bootstrap(page: Page) {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)
  await page.goto(`/${base64Encode(fixture.directory)}/session/${fixture.sourceID}`)
  await expectAppVisible(page.getByText(fixture.expected.sourceTitle).first())
}

function trackPatches(page: Page) {
  const patches: { url: string; body: string }[] = []
  page.on("request", (request: Request) => {
    if (request.method() !== "PATCH") return
    if (!request.url().includes("/session/")) return
    patches.push({ url: request.url(), body: request.postData() ?? "" })
  })
  return patches
}

async function expandSidebar(page: Page) {
  // mod+b 会被聚焦的输入框吞掉,直接点标题栏开关按钮
  await page.getByLabel("Toggle sidebar").first().click()
  await page.waitForTimeout(600)
}

const titleNode = (page: Page) => page.locator('h1[data-slot="session-title-child"]').first()
const titleInput = (page: Page) => page.locator('input[data-slot="session-title-child"]').first()
const row = (page: Page, id: string) => page.locator(`[data-session-id="${id}"]`).first()

test.describe("smoke: session list ux", () => {
  // E1:标题编辑失焦保存
  test("title edit commits on blur", async ({ page }) => {
    await bootstrap(page)
    const patches = trackPatches(page)

    await titleNode(page).dblclick()
    await expect(titleInput(page)).toBeVisible()
    await titleInput(page).fill("Renamed via blur")
    // 点击时间线空白处触发 blur
    await page.getByRole("textbox", { name: /Ask anything/i }).click()

    await expect(titleNode(page)).toHaveText("Renamed via blur")
    expect(patches.some((p) => p.body.includes("Renamed via blur"))).toBe(true)
  })

  // E2:Esc 放弃;清空失焦恢复原名
  test("escape discards and empty commit restores original", async ({ page }) => {
    await bootstrap(page)
    const patches = trackPatches(page)

    await titleNode(page).dblclick()
    await titleInput(page).fill("Should be discarded")
    await page.keyboard.press("Escape")
    await expect(titleNode(page)).toHaveText(fixture.expected.sourceTitle)

    await titleNode(page).dblclick()
    await titleInput(page).fill("")
    await page.getByRole("textbox", { name: /Ask anything/i }).click()
    await expect(titleNode(page)).toHaveText(fixture.expected.sourceTitle)
    expect(patches.length).toBe(0)
  })

  // E3:行右键菜单重命名 → 行内编辑 → blur 保存
  test("row context menu rename edits inline and commits on blur", async ({ page }) => {
    await bootstrap(page)
    const patches = trackPatches(page)
    await expandSidebar(page)

    await row(page, fixture.targetID).click({ button: "right" })
    await page.getByText("Rename", { exact: true }).click()
    const input = page.locator(`input[data-session-rename="${fixture.targetID}"]`)
    await expect(input).toBeVisible()
    await input.fill("Row renamed")
    await page.getByRole("textbox", { name: /Ask anything/i }).click()

    await expect(row(page, fixture.targetID)).toContainText("Row renamed")
    expect(patches.some((p) => p.body.includes("Row renamed"))).toBe(true)
  })

  // E4:右键归档 → 行消失 + 撤销 toast → 撤销 → 行回来(且发出 archived:null)
  test("archive via menu shows undo toast and undo restores the row", async ({ page }) => {
    await bootstrap(page)
    const patches = trackPatches(page)
    await expandSidebar(page)

    await row(page, fixture.targetID).click({ button: "right" })
    await page.getByText("Archive", { exact: true }).click()

    await expect(row(page, fixture.targetID)).not.toBeVisible()
    await expect(page.getByText("Session archived")).toBeVisible()
    await page.getByText("Undo", { exact: true }).click()

    await expect(row(page, fixture.targetID)).toBeVisible()
    expect(patches.some((p) => /"archived":\d+/.test(p.body))).toBe(true)
    expect(patches.some((p) => p.body.includes('"archived":null'))).toBe(true)
  })

  // E5:右键分享(share+复制)与删除(确认框)
  test("share copies link and delete opens confirm dialog", async ({ page }) => {
    await bootstrap(page)
    await expandSidebar(page)
    await page.route("**/session/*/share*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ id: fixture.targetID, share: { url: "https://share.example/abc" } }),
      }),
    )

    await row(page, fixture.targetID).click({ button: "right" })
    await page.getByText("Share", { exact: true }).click()
    await expect(page.getByText("Share URL copied to clipboard!")).toBeVisible()

    // follow-up:复制链接(原生 Copy Link 回归,oc://renderer 同格式内部链接)
    await row(page, fixture.targetID).click({ button: "right" })
    await page.getByText("Copy link", { exact: true }).click()
    await expect(page.getByText("Copied", { exact: true })).toBeVisible()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain(`/session/${fixture.targetID}`)

    await row(page, fixture.targetID).click({ button: "right" })
    await page.getByText("Delete", { exact: true }).click()
    await expect(page.getByRole("heading", { name: "Delete session" })).toBeVisible()
    await page.getByRole("button", { name: "Delete session" }).click()
    await expect(row(page, fixture.targetID)).not.toBeVisible()
  })

  // E6:行 hover 无归档图标
  test("row hover no longer shows archive icon", async ({ page }) => {
    await bootstrap(page)
    await expandSidebar(page)
    await row(page, fixture.targetID).hover()
    expect(await row(page, fixture.targetID).locator('[aria-label="Archive"]').count()).toBe(0)
  })
})


