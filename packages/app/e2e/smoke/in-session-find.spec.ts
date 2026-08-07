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
    const total = Number(first.split("/")[1].replace("+", ""))
    expect(total).toBeGreaterThan(0)

    if (total > 1) {
      // 跳转会触发 hash 机制加载更早历史,total 可能增长(渐进加载),只断言序号
      await findInput(page).press("Enter")
      await expect(findCount(page)).toHaveText(/^2\//)
      await findInput(page).press("Shift+Enter")
      await expect(findCount(page)).toHaveText(/^1\//)
    }

    await page.keyboard.press("Escape")
    await expect(findInput(page)).not.toBeVisible()
  })

  // E1c(bug-repro):命中在视口外的长会话,Enter 跳转必须真滚动到目标可见
  // (修复前 reveal 竞态/scrollTop 钳制导致计数走、视图不动 — user 2026-08-07 报障)
  test("jump scrolls a long session until the match is visible", async ({ page }) => {
    const turns = 40
    const mkUser = (i: number) => ({
      info: {
        id: `msg_long_user_${String(i).padStart(3, "0")}`,
        sessionID: fixture.targetID,
        role: "user",
        time: { created: 1700000000000 + i * 10000 },
        agent: "build",
        model: { providerID: "opencode", modelID: "claude-opus-4-6" },
        summary: { diffs: [] },
      },
      parts: [
        {
          id: `prt_long_user_${String(i).padStart(3, "0")}`,
          sessionID: fixture.targetID,
          messageID: `msg_long_user_${String(i).padStart(3, "0")}`,
          type: "text",
          text: i === 2 ? "这里埋着深位独特词铂金海獭 的关键内容" : `第 ${i} 轮普通内容,填充填充填充。`,
        },
      ],
    })
    const longMessages = Array.from({ length: turns }, (_, i) => mkUser(i))
    await bootstrap(page, {
      pageMessages: (sessionID: string, limit: number, before?: string) => {
        if (sessionID !== fixture.targetID) return pageMessages(sessionID, limit, before)
        const end = before ? Math.max(0, longMessages.findIndex((m) => m.info.id === before)) : longMessages.length
        const start = Math.max(0, end - limit)
        return { items: longMessages.slice(start, end), cursor: start > 0 ? longMessages[start]!.info.id : undefined }
      },
    })
    await openFind(page)
    await findInput(page).fill("铂金海獭")
    await expect(findCount(page)).toHaveText(/^1\/1$/, { timeout: 15000 })
    // 目标词必须滚动进入视口
    await expect(page.getByText("铂金海獭", { exact: false }).first()).toBeInViewport({ timeout: 15000 })
  })

  // E1d(V2):命中只存在于「未加载的深位历史」— 打开查找应后台渐进翻页,总数收敛并可跳达
  test("deep-history-only match is found and reachable via progressive loading", async ({ page }) => {
    const turns = 120
    const mk = (i: number) => ({
      info: {
        id: `msg_deep_user_${String(i).padStart(3, "0")}`,
        sessionID: fixture.targetID,
        role: "user",
        time: { created: 1700000000000 + i * 10000 },
        agent: "build",
        model: { providerID: "opencode", modelID: "claude-opus-4-6" },
        summary: { diffs: [] },
      },
      parts: [
        {
          id: `prt_deep_user_${String(i).padStart(3, "0")}`,
          sessionID: fixture.targetID,
          messageID: `msg_deep_user_${String(i).padStart(3, "0")}`,
          type: "text",
          text: i === 2 ? "深位历史里的唯一词玄铁貂 藏在这里" : `第 ${i} 轮普通内容。`,
        },
      ],
    })
    const deepMessages = Array.from({ length: turns }, (_, i) => mk(i))
    await bootstrap(page, {
      pageMessages: (sessionID: string, limit: number, before?: string) => {
        if (sessionID !== fixture.targetID) return pageMessages(sessionID, limit, before)
        const end = before ? Math.max(0, deepMessages.findIndex((m) => m.info.id === before)) : deepMessages.length
        const start = Math.max(0, end - limit)
        return { items: deepMessages.slice(start, end), cursor: start > 0 ? deepMessages[start]!.info.id : undefined }
      },
    })
    await openFind(page)
    await findInput(page).fill("玄铁貂")
    // 初始窗口(最近 80 轮)没有该词 → 后台深挖 → 总数收敛为 1(且 "+" 消失 = 历史拉完)
    await expect(findCount(page)).toHaveText("1/1", { timeout: 30000 })
    await expect(page.getByText("玄铁貂", { exact: false }).first()).toBeInViewport({ timeout: 15000 })
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
