// FORK: 经典布局是 DeskFox 默认 + 标题栏工具组锚左 [feat: keep-legacy-layout] 2026-08-11
//
// [bug-repro: 上游 v2 换代后有 4 条路径会把用户推到 v2]
//
// 背景:user 2026-08-11 真机试用上游 v2 后决定不采用。上游把 v2 设成默认,并且有 4 条独立路径
//   会把用户推过去(渠道默认 / 新档案默认 / 退役日强制 / 升级迁移强切),少堵一条就会在某个
//   时点自己切回去 —— 本 spec 钉住「什么都不设时进来就是经典布局」这个最终可观测结果。
//
// 覆盖:
//   T1 不种任何布局设置 → 进来就是经典布局(html/body 无 data-new-layout)
//   T2 经典布局下标题栏工具组挂左侧 portal(REQ-041 图标锚左解耦的 UI 微调,user 点名恢复)
import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { makeProject, makeProvider, makeSession } from "../utils/fixtures"

const directory = "C:/OpenCode/ClassicLayoutDefault"
const projectID = "proj_classic_layout"
const sessionID = "ses_classic_layout"
const title = "classic layout default"

async function boot(page: Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: makeProject({ id: projectID, directory, name: title }),
    provider: makeProvider(),
    sessions: [makeSession({ id: sessionID, projectID, directory, title })],
    pageMessages: () => ({ items: [] }),
    events: () => [],
  })
  // 关键:**不种** settings.v3 —— 测的就是「什么都不设时的默认」
}

test.describe("regression: 经典布局默认 (keep-legacy-layout)", () => {
  test("T1 不种任何设置时进来就是经典布局", async ({ page }) => {
    await boot(page)
    await page.goto("/")
    await expect(page.locator("header").first()).toBeVisible({ timeout: 20_000 })
    // v2 会在 body 上打 data-new-layout;经典布局不打
    await expect.poll(() => page.locator("body[data-new-layout]").count(), { timeout: 10_000 }).toBe(0)
  })

  // 注:左 portal(#opencode-titlebar-left)只在**桌面**标题栏渲染,web 端标题栏没有它。
  //   e2e 跑的是 web,所以这里只能守住「回落不丢按钮」这一半;
  //   「桌面经典布局下工具组确实挂左」由真机 CDP 按物理 x 坐标验(见 3-changelog)。
  test("T2 web 端无左 portal 时工具组回落右侧、不整组消失", async ({ page }) => {
    await boot(page)
    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expect(page.locator("header").first()).toBeVisible({ timeout: 20_000 })
    const hasLeft = (await page.locator("#opencode-titlebar-left").count()) > 0
    const mount = page.locator(hasLeft ? "#opencode-titlebar-left" : "#opencode-titlebar-right").first()
    await expect.poll(() => mount.locator("button").count(), { timeout: 15_000 }).toBeGreaterThan(0)
  })
})
