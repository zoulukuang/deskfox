// FORK-ONLY e2e: REQ-097 会话内查找 — ⌘F 查找条 + 计数/跳转/Esc + ⌘K 内容命中联动
// [feat: in-session-find]
import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture, pageMessages } from "./session-timeline.fixture"
import { mockOpenCodeServer, type MockServerConfig } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const HL_START = ""
const HL_END = ""

async function bootstrap(page: Page, extra?: Partial<MockServerConfig>) {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    ...extra,
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
  await page.goto(`/${base64Encode(fixture.directory)}/session/${fixture.targetID}`)
  await expectAppVisible(page.getByText(fixture.expected.targetTitle).first())
}

async function openFind(page: Page) {
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+f")
    await expect(page.locator("[data-deskfox-find-bar]")).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
}

const findInput = (page: Page) => page.getByRole("textbox", { name: "Find in session" })
const findCount = (page: Page) => page.locator("[data-find-count]")

test.describe("smoke: in-session find", () => {
  // E1:⌘F 打开 → 输入词 → 计数 → Enter 前进 → Esc 关闭
  test("cmd+f opens find bar with counts, enter cycles, esc closes", async ({ page }) => {
    await bootstrap(page)
    await openFind(page)

    await findInput(page).fill("signal")
    await expect(findCount(page)).not.toHaveText("0/0", { timeout: 10000 })
    const first = await findCount(page).innerText()
    const total = Number(first.split("/")[1])
    expect(total).toBeGreaterThan(0)

    if (total > 1) {
      await findInput(page).press("Enter")
      await expect(findCount(page)).toHaveText(`2/${total}`)
      await findInput(page).press("Shift+Enter")
      await expect(findCount(page)).toHaveText(`1/${total}`)
    }

    await page.keyboard.press("Escape")
    await expect(findInput(page)).not.toBeVisible()
  })

  // E1b:无命中显示 0/0
  test("no matches shows 0/0", async ({ page }) => {
    await bootstrap(page)
    await openFind(page)
    await findInput(page).fill("绝不存在的词汇xyzzy")
    await expect(findCount(page)).toHaveText("0/0")
  })

  // E2:⌘K 内容命中 → 会话打开 + 查找条带词自动展开 + 计数就绪
  test("palette content hit opens session with find bar pre-filled", async ({ page }) => {
    const anchorID = fixture.expected.targetMessageIDs[0]
    await bootstrap(page, {
      search: ({ query, scope }) =>
        scope === "project" && query === "signal"
          ? {
              hits: [
                {
                  sessionID: fixture.targetID,
                  messageID: anchorID,
                  anchorMessageID: anchorID,
                  partID: "prt_find_hit",
                  projectID: fixture.project.id,
                  kind: "assistant",
                  snippet: `lorem ${HL_START}signal${HL_END} lorem`,
                  timeCreated: 1700000005000,
                  sessionTitle: fixture.expected.targetTitle,
                  directory: fixture.directory,
                },
              ],
            }
          : { hits: [] },
    })
    // 先离开目标会话,验证跳转 + 联动
    await page.goto(`/${base64Encode(fixture.directory)}/session/${fixture.sourceID}`)
    await expectAppVisible(page.getByText(fixture.expected.sourceTitle).first())

    await page.getByLabel("Search files").click()
    const paletteInput = page.getByRole("textbox", { name: "Search files, commands, and sessions" })
    await expect(paletteInput).toBeVisible()
    await paletteInput.fill("signal")
    const hit = page.getByText("lorem", { exact: false }).first()
    await expect(page.getByText("Session content")).toBeVisible()
    await hit.click()

    await expect(findInput(page)).toBeVisible({ timeout: 15000 })
    await expect(findInput(page)).toHaveValue("signal")
    await expect(findCount(page)).not.toHaveText("0/0")
  })
})
