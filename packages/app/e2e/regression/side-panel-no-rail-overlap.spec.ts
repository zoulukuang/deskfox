// FORK: 经典布局镜像 —— 侧面板不得溢出到 activity rail 底下 [feat: mirror-layout-overflow] 2026-08-12
//
// [bug-repro: 窗口宽度不足时,文件树面板左侧被项目图标列(activity rail)盖住 —— user 2026-08-12
//   真机反馈「所有文件这一栏把标题前面挡住了」,截图里 .deskfox 的开头的点被吃掉。
//   CDP 命中测试实证:在「所有文件」tab 自己的矩形内 elementFromPoint 命中的是 rail 的项目图标。]
//
// 根因:REQ-041 五栏镜像用 `md:flex-row-reverse` 实现(session.tsx)。该容器的两个子项
//   (聊天区、侧面板)都是 style 固定宽度,总宽超过可用宽度时会溢出 —— 而 row-reverse 会把
//   溢出方向从「右」翻成「左」,左边正是 rail 的地盘,于是压在 rail 底下被盖住。
//   实测 1280 宽窗口:可用 771,聊天区 570 + 侧面板 240 = 810,超 39px,面板 x 从应有的 64 变成 25。
//
// 修法:改用 `order` 实现镜像(视觉顺序不变、DOM 顺序不变),容器回到正常 `md:flex-row`,
//   溢出方向恢复向右 —— 即 user 要求的「宽度不够该省略右侧,而不是切左边」。
//
// 本 spec 钉住最终可观测结果:经典布局下侧面板左缘**不得小于** rail 右缘。
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { makeProject, makeProvider, makeSession } from "../utils/fixtures"

const directory = "C:/OpenCode/SidePanelOverlap"
const projectID = "proj_side_panel_overlap"
const sessionID = "ses_side_panel_overlap"
const title = "side panel overlap"

async function boot(page: Page) {
  await mockOpenCodeServer(page, {
    directory,
    project: makeProject({ id: projectID, directory, name: title }),
    provider: makeProvider(),
    sessions: [makeSession({ id: sessionID, projectID, directory, title })],
    pageMessages: () => ({ items: [] }),
    events: () => [],
  })
}

test.describe("regression: 经典布局侧面板不压 rail (mirror-layout-overflow)", () => {
  test("T1 窄窗口下镜像容器不得使用 flex-row-reverse(否则溢出方向翻到左侧)", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await boot(page)
    await page.goto("/")
    await expect(page.locator("header").first()).toBeVisible({ timeout: 20_000 })

    // 经典布局(无 data-new-layout)下,不该再有 md:flex-row-reverse 这个镜像实现
    await expect.poll(() => page.locator("body[data-new-layout]").count(), { timeout: 10_000 }).toBe(0)
    const reverseCount = await page.locator(".md\\:flex-row-reverse").count()
    expect(reverseCount, "镜像应改用 order 实现,容器不应再是 row-reverse").toBe(0)
  })

  // 注:「镜像仍生效(侧面板在聊天区左侧)」这一半 **web e2e 验不了** ——
  //   SessionSidePanel 外层是 <Show when={isDesktop() && ...}>,e2e 跑 web 端时 isDesktop() 为 false,
  //   面板压根不渲染,`md:order-first` 自然也不在 DOM 里。同 classic-layout-default.spec.ts 里
  //   左 portal 的限制。该半由**真机 CDP 按物理 x 坐标**验:面板左缘必须 ≥ rail 右缘(见 3-changelog §7.6)。
  //   本 spec 因此只钉住 web 端可观测的那一半:镜像不得再用 row-reverse 实现(否则溢出方向翻左)。

  test("T2 改 order 后页面仍正常渲染,无渲染崩溃", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await boot(page)
    await page.goto("/")
    await expect(page.locator("header").first()).toBeVisible({ timeout: 20_000 })
    // 没有掉进 error.tsx 全屏错误页
    const body = await page.locator("body").innerText()
    expect(body).not.toMatch(/出了点问题|Something went wrong/)
  })
})
