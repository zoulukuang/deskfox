// FORK: REQ-053/058 [feat: v2026.8.2 思考链对齐原生] —— E2E 回归:
//  思考(reasoning)块必须 ① 默认收起 ② 在正文(text)上方 ③ 点击摘要行可展开看全文。
//  复用原生 Collapsible,断言 DOM/aria 而非肉眼截图。模板取自 session-timeline-collapse-state.spec.ts。
import { expect, test, type Locator, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReasoningFoldV2026_8_2"
const projectID = "proj_reasoning_fold"
const sessionID = "ses_reasoning_fold"
const userMessageID = "msg_user_reasoning"
const assistantMessageID = "msg_assistant_reasoning"
const reasoningPartID = "prt_reasoning_fold"
const textPartID = "prt_text_fold"
const title = "Reasoning fold regression"
const reasoningText = "REASONING_BODY_UNIQUE_MARKER step one then step two"
const answerText = "Here is the final answer."
const model = { providerID: "opencode", modelID: "claude-opus-4-6", variant: "max" }

const userMessage = {
  info: {
    id: userMessageID,
    sessionID,
    role: "user",
    time: { created: 1700000000000 },
    summary: { diffs: [] },
    agent: "build",
    model,
  },
  parts: [{ id: "prt_user_text", sessionID, messageID: userMessageID, type: "text", text: "Please think then answer." }],
}

// reasoning 排在 text 之前(stream 天然顺序),用于验证"正文上方"
const reasoningPart = {
  id: reasoningPartID,
  sessionID,
  messageID: assistantMessageID,
  type: "reasoning",
  text: reasoningText,
}
const textPart = {
  id: textPartID,
  sessionID,
  messageID: assistantMessageID,
  type: "text",
  text: answerText,
}

const assistantMessage = {
  info: {
    id: assistantMessageID,
    sessionID,
    role: "assistant",
    time: { created: 1700000001000, completed: 1700000002000 },
    parentID: userMessageID,
    modelID: model.modelID,
    providerID: model.providerID,
    mode: "build",
    agent: "build",
    path: { cwd: directory, root: directory },
    cost: 0.01,
    tokens: { input: 100, output: 200, reasoning: 50, cache: { read: 0, write: 0 } },
    variant: "max",
  },
  parts: [reasoningPart, textPart],
}

test.describe("regression: reasoning fold (REQ-053/058 v2026.8.2)", () => {
  test("reasoning is collapsed by default, sits above the answer text, and expands on click", async ({ page }) => {
    await mockServer(page)
    await configurePage(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const reasoning = page.locator(`[data-timeline-part-id="${reasoningPartID}"]`).first()
    await expectAppVisible(reasoning)

    // ① 默认收起:折叠 trigger aria-expanded=false / collapsible data-closed,且思考全文不可见
    await expectExpanded(reasoning, false)
    await expect(page.getByText(reasoningText, { exact: false })).toBeHidden()

    // ② 在正文上方:reasoning 的 DOM/视觉位置先于 answer text
    const answer = page.getByText(answerText, { exact: false }).first()
    await expectAppVisible(answer)
    const order = await page.evaluate(
      ({ rid, atext }) => {
        const r = document.querySelector(`[data-timeline-part-id="${rid}"]`)
        const all = Array.from(document.querySelectorAll("*")).find(
          (el) => el.childElementCount === 0 && el.textContent?.includes(atext),
        )
        if (!r || !all) return null
        const pos = r.compareDocumentPosition(all)
        // DOCUMENT_POSITION_FOLLOWING (4) => answer 在 reasoning 之后(即 reasoning 在上方)
        return { reasoningBeforeAnswer: !!(pos & Node.DOCUMENT_POSITION_FOLLOWING), rTop: r.getBoundingClientRect().top, aTop: all.getBoundingClientRect().top }
      },
      { rid: reasoningPartID, atext: answerText },
    )
    expect(order?.reasoningBeforeAnswer).toBe(true)
    expect(order!.rTop).toBeLessThanOrEqual(order!.aTop)

    // ③ 点击摘要行展开 → 思考全文可见
    await reasoning.locator('[data-slot="collapsible-trigger"]').first().click()
    await expectExpanded(reasoning, true)
    await expect(page.getByText(reasoningText, { exact: false })).toBeVisible()

    // 答案正文始终可见(不受折叠影响)
    await expectAppVisible(answer)
  })
})

async function configurePage(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { showReasoningSummaries: true, showSessionProgressBar: true } }),
    )
  })
}

async function expectExpanded(locator: Locator, expected: boolean) {
  await expect.poll(() => locator.evaluate(readExpanded)).toBe(expected)
}

function readExpanded(element: Element) {
  const trigger = element.querySelector('[data-slot="collapsible-trigger"]')
  const aria = trigger?.getAttribute("aria-expanded")
  if (aria === "true") return true
  if (aria === "false") return false
  const root = element.querySelector('[data-component="collapsible"]')
  if (root?.hasAttribute("data-expanded")) return true
  if (root?.hasAttribute("data-closed")) return false
  const content = element.querySelector<HTMLElement>('[data-slot="collapsible-content"]')
  return !!content && content.getBoundingClientRect().height > 0
}

async function mockServer(page: Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [session()],
    pageMessages: () => ({ items: [userMessage, assistantMessage] }),
    events: () => [],
  })
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: "reasoning-fold",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  }
}

function session() {
  return {
    id: sessionID,
    slug: "reasoning-fold",
    projectID,
    directory,
    title,
    version: "dev",
    time: { created: 1700000000000, updated: 1700000000000 },
  }
}

function provider() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
    ],
    connected: ["opencode"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  }
}

function base64Encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}
