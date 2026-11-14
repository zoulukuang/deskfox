// FORK-ONLY: visible Markdown link navigation [feat: daily-file-links] 2026-11-14
import { expect, test } from "@playwright/test"
import { bootstrapContextFlow } from "../utils/context-flows"

test.use({ viewport: { width: 1440, height: 900 } })

test("opens an encoded chat file link and navigates document sections without leaving the session", async ({
  page,
}) => {
  const checked: string[] = []
  await page.exposeFunction("fileLinkProbe", (path: string) => {
    checked.push(path)
    if (path !== "guide space.md") throw new Error("missing fixture")
    return 1
  })
  await page.addInitScript(() => {
    Object.defineProperty(window, "deskfox", {
      value: {
        invoke: (command: string, args: { path?: string }) => {
          if (command === "get_file_mtime") {
            return (window as unknown as { fileLinkProbe: (path?: string) => Promise<number> }).fileLinkProbe(args.path)
          }
          if (command === "get_file_size") return Promise.resolve(4096)
          return Promise.reject(new Error(`Unsupported native fixture: ${command}`))
        },
        listen: async () => () => {},
      },
    })
  })
  await bootstrapContextFlow(page, {
    files: [
      {
        name: "guide space.md",
        content: [
          "# Guide start",
          "[Jump to target](#target-section)",
          ...Array.from({ length: 45 }, (_, i) => `Paragraph ${i}.\n`),
          "## Target section",
          "Correct file contents.",
          "[Back to start](#guide-start)",
          "[Missing section](#missing)",
        ].join("\n\n"),
      },
    ],
    messages: [
      { id: "msg_links_user", role: "user", text: "Show the guide." },
      { id: "msg_links_assistant", role: "assistant", text: "[Open guide](./guide%20space.md#target-section)" },
    ],
  })
  const sessionURL = page.url()
  await page.getByRole("link", { name: "Open guide", exact: true }).click()
  const viewer = page.locator('[data-context="file-viewer"]')
  await expect(viewer.getByText("Correct file contents.", { exact: true })).toBeVisible()
  await expect(viewer.getByRole("heading", { name: "Target section", exact: true })).toBeInViewport()
  expect(checked).toContain("guide space.md")
  await expect(page).toHaveURL(sessionURL)

  await viewer.getByRole("link", { name: "Back to start", exact: true }).click()
  await expect(viewer.getByRole("heading", { name: "Guide start", exact: true })).toBeInViewport()
  await expect(page).toHaveURL(sessionURL)
  await viewer.getByRole("link", { name: "Jump to target", exact: true }).click()
  await expect(viewer.getByRole("heading", { name: "Target section", exact: true })).toBeInViewport()
  await viewer.getByRole("link", { name: "Missing section", exact: true }).click()
  await expect(page).toHaveURL(sessionURL)
  await expect(viewer.getByText("Correct file contents.", { exact: true })).toBeVisible()
})
