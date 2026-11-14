import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "D:/OpenCode/VcsRefreshOverload"
const projectID = "proj_vcs_refresh_overload"
const sessionID = "ses_vcs_refresh_overload"
const questionID = "que_vcs_refresh_overload"
const title = "VCS refresh overload"
const time = { created: 1700000000000, updated: 1700000000000 }
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test("merges file changes while a Git diff is in flight", async ({ page }) => {
  await page.clock.install()
  const events = await installSseTransport(page, { server })
  await mockOpenCodeServer(page, {
    protocol: "v1",
    directory,
    project: { id: projectID, worktree: directory, vcs: "git", time, sandboxes: [] },
    provider: { all: [], connected: [], default: {} },
    sessions: [{ id: sessionID, slug: sessionID, projectID, directory, title, version: "dev", time }],
    pageMessages: () => ({ items: [] }),
    files: (path) =>
      path === "src"
        ? [
            {
              path: "src/entry.ts",
              name: "entry.ts",
              absolute: `${directory}/src/entry.ts`,
              type: "file",
              ignored: false,
            },
          ]
        : [{ path: "src", name: "src", absolute: `${directory}/src`, type: "directory", ignored: false }],
    questions: [
      {
        id: questionID,
        sessionID,
        questions: [{ header: "Confirm", question: "Continue?", options: [{ label: "Yes", description: "Continue" }] }],
      },
    ],
  })

  let requests = 0
  let classifications = 0
  await page.route("**/deskfox/vcs/refresh-required**", async (route) => {
    classifications++
    const paths = route.request().postDataJSON().paths as string[]
    expect(paths.length).toBeLessThanOrEqual(128)
    await route.fulfill({
      status: 200,
      json: {
        shouldRefresh: paths.some(
          (file) => !file.includes("/ignored-cache/") && !file.includes("/data/trade_bridge_real/"),
        ),
      },
    })
  })
  let hold = false
  const releaseDiff = Promise.withResolvers<void>()
  await page.route("**/vcs/diff**", async (route) => {
    const number = ++requests
    if (hold) await releaseDiff.promise
    await route.fulfill({
      status: 200,
      json: [{ file: "tracked.ts", additions: number, deletions: 0, status: "modified" }],
    })
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  await events.waitForConnection()
  const fileTree = page.getByRole("button", { name: "Toggle file tree" })
  if ((await fileTree.getAttribute("aria-expanded")) !== "true") await fileTree.click()
  await expect(page.getByRole("tab", { name: /^1 change$/i })).toBeVisible()
  await page.getByRole("tab", { name: "All files" }).click()
  const initialRequests = requests
  hold = true

  const change = async (file: string) => {
    await events.send({ directory, payload: { type: "file.watcher.updated", properties: { file, event: "change" } } })
    await page.clock.runFor(400)
  }

  try {
    await change(`${directory}/.git/index`)
    expect(requests).toBe(initialRequests)
    expect(classifications).toBe(0)
    await change(`${directory}/ignored-cache/asset.json`)
    await expect.poll(() => classifications).toBe(1)
    await page.clock.runFor(400)
    expect(requests).toBe(initialRequests)
    // A detached-HEAD move can change the diff without changing the branch key.
    await change(`${directory}/.git/HEAD`.replaceAll("/", "\\"))
    await expect.poll(() => requests).toBe(initialRequests + 1)
    expect(classifications).toBe(1) // HEAD bypasses Git-ignore classification.
    await change(`${directory}/tracked.ts`)
    await expect.poll(() => requests).toBe(initialRequests + 1)
    for (let index = 0; index < 8; index++) {
      await change(`${directory}/data/trade_bridge_real/asset.json`)
    }

    await page.getByRole("button", { name: "src", exact: true }).click()
    await expect(page.getByText("entry.ts", { exact: true })).toBeVisible()
    const question = page.locator('[data-component="dock-prompt"][data-kind="question"]')
    await question.getByRole("radio", { name: /^Yes/ }).click()
    const reply = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === `/question/${questionID}/reply`,
    )
    await question.getByRole("button", { name: "Submit" }).click()
    expect((await reply).ok()).toBe(true)
    expect(requests - initialRequests).toBe(1)
  } finally {
    releaseDiff.resolve()
  }

  await expect.poll(() => requests - initialRequests).toBe(2)
  await page.clock.runFor(400)
  expect(requests - initialRequests).toBe(2)
})
