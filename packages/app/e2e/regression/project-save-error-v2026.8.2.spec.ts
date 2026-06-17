// FORK: REQ-064 止血 [feat: v2026.8.2 编辑项目保存失败不静默] —— E2E 回归:
//  编辑项目对话框保存失败时,必须弹错误 toast 且对话框保持打开(不再静默卡死)。
//  入口:左侧项目头像 [data-action="project-switch"] 右键 → 上下文菜单"编辑"。
//  非-global 项目走 project.update;拦截 update 返 500 触发 saveMutation 的 onError。
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/ProjectSaveErrorV2026_8_2"
const projectID = "proj_save_error_v2026_8_2"
const title = "Save error regression"

test.describe("regression: edit-project save failure shows toast (REQ-064 v2026.8.2)", () => {
  test("failing project.update surfaces an error toast and keeps the dialog open", async ({ page }) => {
    let updateHit = false
    await mockServer(page)
    await page.route("**/*", async (route) => {
      const req = route.request()
      const u = new URL(req.url())
      if (req.method() !== "GET" && /\/project(\/|$|\?)/.test(u.pathname)) {
        updateHit = true
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify({ error: "forced failure for REQ-064 test" }),
        })
      }
      return route.fallback()
    })

    // 打开项目(点底部近期项目行)
    await page.goto("/")
    const recentRow = page.getByRole("button", { name: /ProjectSaveErrorV2026_8_2/ }).first()
    await expectAppVisible(recentRow)
    await recentRow.click()

    // 右键左侧项目头像 → 上下文菜单"编辑"(用 page.mouse 原始右键,与真机一致)
    const avatar = page.locator('[data-action="project-switch"]').first()
    await avatar.waitFor({ state: "visible", timeout: 15_000 })
    await page.waitForTimeout(800)
    const box = await avatar.boundingBox()
    if (!box) throw new Error("avatar has no bounding box")
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" })
    const editItem = page.getByText("Edit", { exact: true }).first()
    await editItem.waitFor({ state: "visible", timeout: 8_000 })
    await editItem.click()

    // 编辑对话框
    const dialogTitle = page.getByText("Edit project", { exact: true }).first()
    await expectAppVisible(dialogTitle)

    // 改名 → 保存(update 被拦截返 500)
    await page.locator('input[type="text"]').first().fill("renamed-by-test")
    await page.getByRole("button", { name: "Save" }).first().click()

    // 断言:错误 toast 出现 + 对话框仍在(未静默关闭/卡死)
    await expect(page.locator('[data-component="toast"]').filter({ hasText: "Request failed" }).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(dialogTitle).toBeVisible()
    expect(updateHit).toBe(true)
  })
})

async function mockServer(page: Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: project(),
    provider: provider(),
    sessions: [],
    pageMessages: () => ({ items: [] }),
    events: () => [],
  })
}

function project() {
  return {
    id: projectID,
    worktree: directory,
    vcs: "git",
    name: title,
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
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
