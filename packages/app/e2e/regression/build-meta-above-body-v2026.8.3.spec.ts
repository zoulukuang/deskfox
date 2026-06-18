// FORK: REQ-066 [feat: v2026.8.3 Build meta 行位置] —— E2E 回归:
//   Build(agent/model/duration)摘要行必须 ① 默认收起 ② 在正文(text-part-body)上方
//   ③ 点击折叠头可展开 ④ DOM 顺序 build-meta 节点先于 text-part-body 节点。
//   data-* 断言:避免肉眼截图,locale 已钉 en-US(playwright.config.ts)。
import { expect, test, type Locator } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"
import {
  assistantMessage,
  base64Encode,
  makeProject,
  makeProvider,
  makeSession,
  textPart,
  userMessage,
} from "../utils/fixtures"

const directory = "C:/OpenCode/BuildMetaAboveBody_REQ066"
const projectID = "proj_build_meta_066"
const sessionID = "ses_build_meta_066"
const textPartID = "prt_text_meta_066"
const title = "Build meta above body regression"
const answerText = "BUILD_META_ANSWER_MARKER_REQ066"

const msgUser = userMessage({ id: "msg_u_066", sessionID, text: "Do something please." })
const msgAssistant = assistantMessage({
  id: "msg_a_066",
  sessionID,
  parentID: "msg_u_066",
  parts: [textPart(textPartID, answerText)],
})

test.describe("regression: Build meta above body (REQ-066 v2026.8.3)", () => {
  test("build-meta is collapsed by default, sits above text-part-body, and expands on click", async ({ page }) => {
    await mockOpenCodeServer(page, {
      directory,
      project: makeProject({ id: projectID, directory, name: "build-meta-066" }),
      provider: makeProvider(),
      sessions: [makeSession({ id: sessionID, projectID, directory, title })],
      pageMessages: () => ({ items: [msgUser, msgAssistant] }),
      events: () => [],
    })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    // 等待正文出现
    const answerEl = page.getByText(answerText, { exact: false }).first()
    await expectAppVisible(answerEl)

    // 定位 build-meta 折叠组件
    const buildMeta = page.locator('[data-component="build-meta"]').first()
    await expectAppVisible(buildMeta)

    // ① 默认收起:折叠 trigger aria-expanded=false
    await expectExpanded(buildMeta, false)

    // ② DOM 顺序:build-meta 节点在 text-part-body 之前
    const orderCorrect = await page.evaluate(() => {
      const meta = document.querySelector('[data-component="build-meta"]')
      const body = document.querySelector('[data-slot="text-part-body"]')
      if (!meta || !body) return null
      const pos = meta.compareDocumentPosition(body)
      // DOCUMENT_POSITION_FOLLOWING (4) => body 在 meta 之后(即 meta 在上方)
      return !!(pos & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(orderCorrect).toBe(true)

    // ③ 点击折叠 trigger 展开
    await buildMeta.locator('[data-slot="collapsible-trigger"]').first().click()
    await expectExpanded(buildMeta, true)

    // 展开后正文仍可见
    await expectAppVisible(answerEl)
  })
})

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
