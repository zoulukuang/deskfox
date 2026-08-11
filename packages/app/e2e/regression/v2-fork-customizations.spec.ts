// FORK: v2 布局下 fork 定制可达性守卫 [feat: upstream-sync-2026-08] 2026-08-11
//
// [bug-repro: 上游 v2 默认后,创作模式入口与飞书设置页在用户实际路径上消失]
//
// 背景:上游 v1.17.19+ 把 v2 界面设为默认(newLayoutDesigns=true),v2 是**整套新组件**
//   (settings-v2/ 、new-session/ 、prompt-input-v2),而这两项 fork 定制当时只挂在 legacy
//   组件上 → 段3/段4 的 e2e 123/123 全绿也照样漏掉,因为那些用例断言的是上游语义。
//   本 spec 专门钉住「v2 路径下这些定制还在不在」,下次 sync 若再被上游换代冲掉会直接红。
//
// 覆盖:
//   T1 v2 设置对话框有「飞书桥接」tab,点开能渲染面板
//   T2 v2 composer 渲染创作模式菜单(media-gen 入口)
//   T3 v2 设置 tab 集合完整(通用/快捷键/服务器/提供商/模型/飞书)
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { makeProject, makeProvider, makeSession } from "../utils/fixtures"

const directory = "C:/OpenCode/V2ForkGuard"
const projectID = "proj_v2_fork_guard"
const sessionID = "ses_v2_fork_guard"
const title = "v2 fork customization guard"

const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

async function bootV2(page: Page, seed?: (args: { directory: string; server: string; draftID: string }) => void) {
  await mockOpenCodeServer(page, {
    directory,
    project: makeProject({ id: projectID, directory, name: title }),
    provider: makeProvider(),
    sessions: [makeSession({ id: sessionID, projectID, directory, title })],
    pageMessages: () => ({ items: [] }),
    events: () => [],
  })
  // 显式种 v2:本 spec 测的就是 v2 路径,不依赖默认值(默认值本身随上游漂移)
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })
  if (seed) await page.addInitScript(seed, { directory, server, draftID })
}

const draftID = "draft_v2_fork_guard"

async function openV2Settings(page: Page) {
  // v2 没有标题栏设置按钮,走命令面板注册的 "Open settings"(与真实用户路径一致:菜单▸文件▸设置 同一命令)
  await page.keyboard.press("Control+,")
  const dialog = page.locator('[data-component="dialog-v2"]').first()
  await dialog.waitFor({ state: "visible", timeout: 15_000 })
  return dialog
}

test.describe("regression: v2 布局下 fork 定制可达性 (upstream-sync-2026-08)", () => {
  test("T1 v2 设置对话框有飞书桥接 tab 且能打开面板", async ({ page }) => {
    await bootV2(page)
    await page.goto("/")
    const dialog = await openV2Settings(page)

    const feishuTab = dialog.getByRole("tab", { name: /feishu|飞书|lark/i }).first()
    await expect(feishuTab).toBeVisible({ timeout: 8_000 })

    await feishuTab.click()
    // 面板渲染出来即可(账号列表为空是正常态,只要不是「tab 不存在」)
    await expect(dialog.locator('[data-component="settings-feishu"]').first()).toBeVisible({ timeout: 8_000 })
  })

  test("T2 v2 composer 渲染创作模式入口", async ({ page }) => {
    // 主页没有 composer,要进到新会话页(v2 走 new-session-view → PromptInputV2Composer)
    await bootV2(page, ({ directory, server, draftID }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "draft", draftID, server, directory }]),
      )
    })
    await page.goto(`/new-session?draftId=${draftID}`)
    // 锚点用 MediaModeMenu 自带的 data-action="media-mode"(fork 既有稳定选择器)
    await expect(page.locator('[data-action="media-mode"]').first()).toBeVisible({ timeout: 20_000 })
  })

  test("T3 v2 设置 tab 集合完整(含 fork 自有页)", async ({ page }) => {
    await bootV2(page)
    await page.goto("/")
    const dialog = await openV2Settings(page)
    const tabs = dialog.getByRole("tab")
    await expect(tabs.first()).toBeVisible({ timeout: 8_000 })
    // 上游 5 页 + fork 飞书 = 6
    await expect.poll(() => tabs.count(), { timeout: 8_000 }).toBeGreaterThanOrEqual(6)
  })
})
