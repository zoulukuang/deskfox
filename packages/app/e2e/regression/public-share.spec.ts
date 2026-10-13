import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { base64Encode, makeProject, makeProvider, makeSession, userMessage } from "../utils/fixtures"

const directory = "/tmp/share-routing-fixture"
const session = makeSession({
  id: "ses_share_route",
  projectID: "proj_share",
  directory,
  title: "Regional share fixture",
})
const capability = {
  paths: {
    "/session/{sessionID}/share": {
      post: { parameters: [{ name: "shareTarget", in: "query", schema: { enum: ["cn", "global"] } }] },
    },
  },
}

async function setup(page: Page, locale: string, supported = true) {
  page.on("pageerror", (error) => console.error("share page error", error.message))
  page.on("console", (message) => {
    if (message.type() === "error") console.error("share console", message.text())
  })
  const published: { url: URL; directory?: string }[] = []
  await mockOpenCodeServer(page, {
    protocol: "v1",
    provider: makeProvider(),
    directory,
    project: makeProject({ directory, id: "proj_share" }),
    sessions: [session],
    pageMessages: () => ({
      items: [userMessage({ id: "msg_share", sessionID: session.id, text: "Public test content" })],
    }),
  })
  await page.route("**/doc", (route) => route.fulfill({ json: supported ? capability : { paths: {} } }))
  await page.route(`**/session/${session.id}/share?*`, (route) => {
    published.push({
      url: new URL(route.request().url()),
      directory: route.request().headers()["x-opencode-directory"],
    })
    return route.fulfill({ json: { ...session, share: { url: "https://deskfox.ai/share/test-fixture" } } })
  })
  await page.addInitScript(
    ({ locale }) => {
      localStorage.setItem("language.v1", JSON.stringify({ locale }))
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    },
    { locale },
  )
  await page.goto(`/${base64Encode(directory)}/session/${session.id}`)
  await expect(page.getByText("Public test content").first()).toBeVisible()
  return published
}

test("unsupported sharing is visible and does not send a create request", async ({ page }) => {
  const published = await setup(page, "en", false)
  await page.getByRole("button", { name: "More options", exact: true }).last().click()
  await page.getByRole("menuitem", { name: /^Share/ }).click()
  await page.getByRole("button", { name: "Publish", exact: true }).click()
  await expect(
    page.getByText("This server does not support regional sharing. Update the server before sharing."),
  ).toBeVisible()
  expect(published).toHaveLength(0)
})

test("menu publish sends the captured simplified-Chinese target and directory", async ({ page }) => {
  const published = await setup(page, "zh")
  await page.getByRole("button", { name: "更多选项", exact: true }).last().click()
  await page.getByRole("menuitem", { name: /^分享/ }).click()
  await page.getByRole("button", { name: "发布", exact: true }).click()
  await expect.poll(() => published.length).toBe(1)
  expect(published[0].url.searchParams.get("shareTarget")).toBe("cn")
  expect(decodeURIComponent(published[0].directory ?? "")).toBe(directory)
})

test("command palette sharing sends the global target", async ({ page }) => {
  const published = await setup(page, "en")
  const modifier = await page.evaluate(() => (/Mac|iPod|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control"))
  await page.keyboard.press(`${modifier}+k`)
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await dialog.getByRole("textbox").fill("Share session")
  await dialog.getByText("Share session", { exact: true }).click()
  await expect.poll(() => published.length).toBe(1)
  expect(published[0].url.searchParams.get("shareTarget")).toBe("global")
  expect(decodeURIComponent(published[0].directory ?? "")).toBe(directory)
})
