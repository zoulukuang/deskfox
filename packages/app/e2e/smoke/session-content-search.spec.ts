// FORK-ONLY e2e: REQ-095 会话内容搜索 — ⌘K「会话内容」分组 happy path + 全局切换
// [feat: session-content-search]
import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { fixture, pageMessages } from "./session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const HL_START = "\uE000"
const HL_END = "\uE001"

// 命中锚定到 target 会话的第一条 user 消息(fixture 里真实存在,跳转后可定位)
const anchorMessageID = fixture.expected.targetMessageIDs[0]
const globalDirectory = "C:/OpenCode/OtherProject"

const projectHit = {
  sessionID: fixture.targetID,
  messageID: anchorMessageID,
  anchorMessageID,
  partID: "prt_search_hit",
  projectID: fixture.project.id,
  kind: "assistant",
  snippet: `sample ${HL_START}physics${HL_END} analysis snippet`,
  timeCreated: 1700000005000,
  sessionTitle: fixture.expected.targetTitle,
  directory: fixture.directory,
}

const globalHit = {
  sessionID: "ses_other_project",
  messageID: "msg_other_0001",
  anchorMessageID: "msg_other_0001",
  partID: "prt_other_hit",
  projectID: "proj_other",
  kind: "user",
  snippet: `global ${HL_START}physics${HL_END} elsewhere`,
  timeCreated: 1700000006000,
  sessionTitle: "Other project session",
  directory: globalDirectory,
  projectName: "other-project",
  projectWorktree: globalDirectory,
}

async function bootstrap(page: Page, search: (params: { query: string; scope: string }) => unknown) {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    search,
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

async function openPaletteAndType(page: Page, query: string) {
  // "mod+k,mod+p" 是 chord 键,e2e 用标题栏搜索按钮打开面板更稳
  await page.getByLabel("Search files").click()
  const input = page.getByRole("textbox", { name: "Search files, commands, and sessions" })
  await expect(input).toBeVisible()
  await input.fill(query)
}

test.describe("smoke: session content search", () => {
  // E1:⌘K 输关键词 → 「会话内容」分组 → 点击 → 跳会话 + #message- 锚点定位
  test("palette shows content hits and navigates to the anchored message", async ({ page }) => {
    await bootstrap(page, ({ query, scope }) => {
      if (scope === "project" && query === "physics") return { hits: [projectHit] }
      return { hits: [] }
    })
    await openPaletteAndType(page, "physics")

    await expect(page.getByText("Session content")).toBeVisible()
    const hitRow = page.getByText("analysis snippet", { exact: false })
    await expect(hitRow).toBeVisible()

    await hitRow.click()
    await expect(page).toHaveURL(new RegExp(`session/${fixture.targetID}#message-${anchorMessageID}`))
    // 定位:锚点元素滚入可视区
    await expect(page.locator(`#message-${anchorMessageID}`)).toBeVisible()
  })

  // E2:当前项目零命中 → 「在所有项目中搜索」→ 全局命中(带项目名),面板不关闭
  test("zero project hits offers global scope toggle with cross-project results", async ({ page }) => {
    await bootstrap(page, ({ query, scope }) => {
      if (query !== "physics") return { hits: [] }
      if (scope === "global") return { hits: [globalHit] }
      return { hits: [] }
    })
    await openPaletteAndType(page, "physics")

    const toggle = page.getByText("Search in all projects")
    await expect(toggle).toBeVisible()
    await toggle.click()

    // 面板未关闭,出全局命中 + 项目标签 + 反向切换行
    await expect(page.getByText("Other project session")).toBeVisible()
    await expect(page.getByText("other-project")).toBeVisible()
    await expect(page.getByText("Search this project only")).toBeVisible()
  })

  // bug-repro:中文单字查询被旧门槛 query.length < 2 拦死,内容搜索整组不发请求(真机「南」截图复现 2026-08-07)
  test("single CJK character query still reaches content search", async ({ page }) => {
    await bootstrap(page, ({ query, scope }) => {
      if (scope === "project" && query === "南") return { hits: [projectHit] }
      return { hits: [] }
    })
    await openPaletteAndType(page, "南")

    await expect(page.getByText("Session content")).toBeVisible()
    await expect(page.getByText("analysis snippet", { exact: false })).toBeVisible()
  })

  // 降级:unavailable → 分组整组不出现,其余分组正常
  test("unavailable backend hides the content group silently", async ({ page }) => {
    await bootstrap(page, () => ({ unavailable: true, hits: [] }))
    await openPaletteAndType(page, "physics")

    await expect(page.getByRole("textbox", { name: "Search files, commands, and sessions" })).toBeVisible()
    await expect(page.getByText("Session content")).not.toBeVisible()
  })
})
