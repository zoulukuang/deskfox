import { test, expect } from "@playwright/test"
import { randomBytes } from "node:crypto"

test("public page renders a rich conversation and revocation removes it", async ({ page, request }) => {
  const created = await request.post("/api/share", {
    headers: { "idempotency-key": randomBytes(32).toString("hex") },
    data: { sessionID: "ses_browser" },
  })
  expect(created.status()).toBe(200)
  const share = (await created.json()) as { id: string; secret: string }
  const part = (id: string, fields: Record<string, unknown>) => ({
    type: "part",
    data: { id, sessionID: "ses_browser", messageID: "msg_assistant", ...fields },
  })
  const snapshot = [
    {
      type: "session",
      data: {
        id: "ses_browser",
        slug: "browser",
        projectID: "proj_test",
        directory: "/fixture",
        version: "1",
        title: "Public rich conversation",
        time: { created: 1, updated: 3 },
      },
    },
    {
      type: "message",
      data: {
        id: "msg_user",
        sessionID: "ses_browser",
        role: "user",
        agent: "build",
        model: { providerID: "test", modelID: "test" },
        time: { created: 1 },
      },
    },
    {
      type: "part",
      data: {
        id: "prt_user",
        sessionID: "ses_browser",
        messageID: "msg_user",
        type: "text",
        text: "Please explain the example",
      },
    },
    {
      type: "part",
      data: {
        id: "prt_image", sessionID: "ses_browser", messageID: "msg_user", type: "file", mime: "image/png", filename: "pixel.png",
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l4sAAAAASUVORK5CYII=",
      },
    },
    {
      type: "message",
      data: {
        id: "msg_assistant",
        sessionID: "ses_browser",
        role: "assistant",
        parentID: "msg_user",
        modelID: "test",
        providerID: "test",
        mode: "build",
        agent: "build",
        path: { cwd: "/fixture", root: "/fixture" },
        cost: 0,
        tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop",
        time: { created: 2, completed: 3 },
      },
    },
    part("prt_1_tool", {
      type: "tool",
      tool: "read",
      callID: "call_test",
      state: {
        status: "completed",
        input: { filePath: "/fixture/example.txt" },
        output: "TOOL_OUTPUT_TEST",
        title: "example.txt",
        metadata: {},
        time: { start: 2, end: 3 },
      },
    }),
    part("prt_2_text", {
      type: "text",
      text: "## Verified heading\n\n**Bold example** with `inline code`.\n\n```js\nconsole.log(42)\n```\n\n$$x^2 + y^2 = z^2$$\n\n[unsafe](javascript:alert('bad'))",
    }),
    {
      type: "session_diff",
      data: [{ file: "example.txt", before: "old\n", after: "new\n", additions: 1, deletions: 1, status: "modified" }],
    },
  ]
  try {
    expect(
      (await request.post(`/api/share/${share.id}/sync`, { data: { secret: share.secret, data: snapshot } })).status(),
    ).toBe(200)
    const errors: string[] = []
    const failed: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("response", (response) => {
      if (response.status() >= 400) failed.push(response.url())
    })
    page.on("dialog", (dialog) => {
      errors.push(`Unexpected dialog: ${dialog.message()}`)
      void dialog.dismiss()
    })
    const response = await page.goto(`/share/${share.id}`)
    expect(response?.status()).toBe(200)
    const attachment = page.locator('img[src^="data:image/png"]:visible').first()
    await expect(attachment).toBeVisible()
    expect(await attachment.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
    await expect(page.getByText("Please explain the example").filter({ visible: true }).first()).toBeVisible()
    await expect(page.getByRole("heading", { name: "Verified heading" })).toBeVisible()
    await expect(page.locator(".katex:visible").first()).toBeVisible()
    await page.getByRole("button", { name: /^Explored/ }).click()
    await expect(page.getByText("example.txt").filter({ visible: true }).first()).toBeVisible()
    const review = page.getByRole("tab", { name: "1 Files Changed" })
    if (await review.isVisible()) await review.click()
    await expect(page.getByRole("button", { name: "example.txt +1 -1" })).toBeVisible()
    expect(await page.locator('a[href^="javascript:"]').count()).toBe(0)
    expect(await page.content()).not.toContain(share.secret)
    expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("/share-assets/deskfox.png")
    expect(errors).toEqual([])
    expect(failed).toEqual([])
    expect((await request.delete(`/api/share/${share.id}`, { data: { secret: share.secret } })).status()).toBe(200)
    const revoked = await page.reload()
    expect(revoked?.status()).toBe(404)
    expect(revoked?.headers()["cache-control"]).toBe("no-store")
    await expect(page.getByText("This share is unavailable")).toBeVisible()
    await expect(page.getByText("Please explain the example")).toHaveCount(0)
  } finally {
    await request.delete(`/api/share/${share.id}`, { data: { secret: share.secret } })
  }
})
