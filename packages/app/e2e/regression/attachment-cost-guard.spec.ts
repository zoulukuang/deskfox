import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import {
  assistantMessage,
  base64Encode,
  makeProject,
  makeProvider,
  makeSession,
  textPart,
  userMessage,
} from "../utils/fixtures"

const directory = "C:/OpenCode/AttachmentGuard"
const sessionID = "ses_attachment_guard"
const projectID = "proj_attachment_guard"

test("completed input growth warns once and offers the existing session actions", async ({ page }) => {
  const first = userMessage({ id: "msg_001", sessionID, text: "First question" })
  const old = assistantMessage({
    id: "msg_002",
    sessionID,
    parentID: first.info.id,
    parts: [textPart("prt_001", "Baseline answer")],
  })
  const baseline = { ...old, info: { ...old.info, finish: "stop", tokens: { ...old.info.tokens, input: 50_000 } } }
  const events: { directory: string; payload: Record<string, unknown> }[] = []
  await mockOpenCodeServer(page, {
    directory,
    project: makeProject({ id: projectID, directory }),
    provider: makeProvider(),
    sessions: [makeSession({ id: sessionID, projectID, directory })],
    pageMessages: () => ({ items: [first, baseline] }),
    events: () => events.splice(0),
    eventRetry: 100,
  })
  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expect(page.getByText("Baseline answer", { exact: true })).toBeVisible()
  await expect(page.getByText("Model input increased sharply", { exact: true })).toHaveCount(0)
  const next = userMessage({ id: "msg_003", sessionID, text: "Next question" })
  const response = assistantMessage({
    id: "msg_004",
    sessionID,
    parentID: next.info.id,
    parts: [textPart("prt_002", "Large input answer")],
  })
  const info = {
    ...response.info,
    finish: "stop",
    tokens: { ...response.info.tokens, input: 50_000, cache: { read: 50_000, write: 50_000 } },
  }
  events.push(
    ...[
      { type: "message.updated", properties: { info: next.info } },
      ...next.parts.map((part) => ({ type: "message.part.updated", properties: { part } })),
      { type: "message.updated", properties: { info } },
      ...response.parts.map((part) => ({ type: "message.part.updated", properties: { part } })),
      { type: "session.status", properties: { sessionID, status: { type: "idle" } } },
    ].map((payload) => ({ directory, payload })),
  )
  await expect(page.getByText("Model input increased sharply", { exact: true })).toBeVisible()
  await expect(page.getByText(/Input grew from 50,000 to 150,000/)).toBeVisible()
  const toast = page.locator('[data-component="toast"]').filter({ hasText: "Model input increased sharply" })
  await expect(toast.getByRole("button", { name: "New session", exact: true })).toBeVisible()
  await expect(toast.getByRole("button", { name: "Compact session", exact: true })).toBeVisible()
})

for (const scenario of [
  { modern: false, zh: false },
  { modern: true, zh: false },
  { modern: true, zh: true },
]) {
  const modern = scenario.modern
  const zh = scenario.zh
  test(`attachment confirmation cancels without sending then sends once (${modern ? "v2" : "classic"}, ${zh ? "zh" : "en"})`, async ({
    page,
  }) => {
    await mockOpenCodeServer(page, {
      directory,
      project: makeProject({ id: projectID, directory }),
      provider: makeProvider(),
      sessions: [makeSession({ id: sessionID, projectID, directory })],
      pageMessages: () => ({ items: [] }),
    })
    await page.addInitScript(
      (modern) => localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: modern } })),
      modern,
    )
    if (zh)
      await page.addInitScript(() =>
        localStorage.setItem("opencode.global.dat:language", JSON.stringify({ locale: "zh" })),
      )
    const sent: string[] = []
    await page.route("**/session/*/prompt_async*", async (route) => {
      sent.push(route.request().postData() ?? "")
      await route.fulfill({ status: 204 })
    })
    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    const input = page.locator('[contenteditable="true"][data-component="prompt-input"]')
    await expect(input).toBeVisible()
    await input.fill("Inspect this attachment")
    const chooser = page.waitForEvent("filechooser")
    await page
      .getByRole("button", { name: zh ? "添加图片和文件" : modern ? "Add images and files" : "Add files", exact: true })
      .click()
    if (modern) await page.getByRole("menuitem", { name: zh ? "图片和文件" : "Images and files" }).click()
    await (
      await chooser
    ).setFiles([
      { name: "large.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n".repeat(216_000)) },
      {
        name: "large.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(6_400_000 - 8, 32)]),
      },
    ])
    await expect(page.getByText("large.csv", { exact: true })).toBeVisible()
    await expect(page.getByText("large.pdf", { exact: true })).toBeVisible()
    await input.press("Enter")
    const confirmation = page.getByRole("dialog", { name: zh ? "发送大附件？" : "Send large attachments?" })
    await expect(confirmation).toBeVisible()
    await confirmation.screenshot({
      path: `/tmp/attachment-confirm-${modern ? "v2" : "classic"}-${zh ? "zh" : "en"}.png`,
    })
    expect(sent).toHaveLength(0)
    await confirmation.getByRole("button", { name: zh ? "取消" : "Cancel", exact: true }).click()
    await expect(confirmation).toBeHidden()
    await expect(input).toHaveText("Inspect this attachment")
    await expect(page.getByText("large.csv", { exact: true })).toBeVisible()
    expect(sent).toHaveLength(0)
    await input.press("Enter")
    await expect(confirmation).toBeVisible()
    const request = page.waitForRequest(
      (request) => request.url().includes("/prompt_async") && request.method() === "POST",
    )
    await confirmation.getByRole("button", { name: zh ? "继续发送" : "Continue sending", exact: true }).click()
    await request
    await expect(input).toHaveText("")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain("large.csv")
    expect(sent[0]).toContain("large.pdf")
  })
}
