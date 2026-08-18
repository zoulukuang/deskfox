import { benchmark, expect } from "../benchmark"
import { expectSessionTitle } from "../../utils/waits"
import { measureNavigationMilestones } from "./navigation-milestones"
import { fixture } from "./session-timeline-stress.fixture"
import {
  createReviewDiffs,
  installStressSessionTabs,
  installTimelineSettings,
  mockStressTimeline,
  stressSessionHref,
} from "./timeline-test-helpers"
import { waitForStableTimeline } from "./session-tab-switch-probe"

const homeRow = '[data-component="home-session-row"]'
const homeShell = '[data-component="home-session-search"]'
// FORK: 新布局(installTimelineSettings 写死 newLayoutDesigns:true)下 review 走 v2 侧栏,
//   旧的 `[data-component="session-review"]` 是 v1 组件、在这套设置下永不出现。
//   2026-08-18 [feat: voice-preclear-batch]
const reviewBody = '[data-slot="session-review-v2-diff-scroll"]'

benchmark.describe("performance: home and tab navigation", () => {
  benchmark("opens a home session and paints its titlebar tab", async ({ page, report }) => {
    await setup(page, [])
    await page.goto("/")
    const row = page.locator(homeRow).filter({ hasText: fixture.expected.targetTitle }).first()
    await expect(row).toBeVisible()
    const href = stressSessionHref(fixture.targetID)
    const result = await measureNavigationMilestones(page, {
      triggerSelector: homeRow,
      milestones: {
        content: { selector: messageSelector(fixture.expected.targetMessageIDs.at(-1)!) },
        tab: { selector: `[data-slot="titlebar-tabs"] a[href="${href}"]` },
      },
      navigate: async () => {
        await row.click()
        await expectSessionTitle(page, fixture.expected.targetTitle)
      },
    })
    report(result)
    await expect(page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`)).toContainText(
      fixture.expected.targetTitle,
    )
  })

  benchmark("stages the review body after cold session content", async ({ page, report }) => {
    await setup(page, [], { reviewDiffs: true })
    // FORK: review 面板默认收起,冷进入时压根不挂载 —— 采样必然恒为「content && !review」,
    //   这条测试原本什么都没测到,最后那句可见断言也永远等不到(REQ-117 A 族真根因,与冷启动耗时无关)。
    //   先进一次 session 把面板打开(状态持久化在 layout store),回首页后再冷点进入,
    //   review 才会与正文同批挂载,「正文先于 review body 出现」这个断言才真的有测头。
    //   2026-08-18 [feat: voice-preclear-batch]
    await page.goto(stressSessionHref(fixture.targetID))
    await expectSessionTitle(page, fixture.expected.targetTitle)
    await page.getByRole("button", { name: "Toggle review" }).click()
    await expect(page.locator(reviewBody)).toBeVisible()
    await page.goto("/")
    const row = page.locator(homeRow).filter({ hasText: fixture.expected.targetTitle }).first()
    await expect(row).toBeVisible()
    const result = await page.evaluate(
      ({ rowSelector, title, contentSelector, reviewSelector }) =>
        new Promise<{ contentBeforeReview: boolean; samples: number }>((resolve) => {
          let samples = 0
          const sample = () => {
            samples++
            const content = !!document.querySelector(contentSelector)
            const review = !!document.querySelector(reviewSelector)
            if (content && !review) {
              resolve({ contentBeforeReview: true, samples })
              return
            }
            if (content && review) {
              resolve({ contentBeforeReview: false, samples })
              return
            }
            requestAnimationFrame(sample)
          }
          const target = [...document.querySelectorAll<HTMLElement>(rowSelector)].find((item) =>
            item.textContent?.includes(title),
          )
          if (!target) throw new Error(`Home session row not found: ${title}`)
          target.click()
          requestAnimationFrame(sample)
        }),
      {
        rowSelector: homeRow,
        title: fixture.expected.targetTitle,
        contentSelector: messageSelector(fixture.expected.targetMessageIDs.at(-1)!),
        reviewSelector: reviewBody,
      },
    )
    report(result)
    expect(result.contentBeforeReview).toBe(true)
    await expect(page.locator(reviewBody)).toBeVisible()
  })

  benchmark("closes the only session tab and paints home", async ({ page, report }) => {
    await setup(page, [fixture.sourceID])
    const href = stressSessionHref(fixture.sourceID)
    await page.goto(href)
    await expectSessionTitle(page, fixture.expected.sourceTitle)
    await waitForStableTimeline(page, fixture.expected.sourceMessageIDs.at(-1)!)
    const tab = page.locator(`[data-slot="titlebar-tabs"] a[href="${href}"]`).first()
    const close = tab.locator("..").locator('[data-component="icon-button-v2"]')
    await expect(close).toBeVisible()
    const result = await measureNavigationMilestones(page, {
      triggerSelector: '[data-slot="titlebar-tabs"] [data-component="icon-button-v2"]',
      milestones: {
        home: { selector: homeShell },
        row: { selector: homeRow },
        tabRemoved: { selector: `[data-slot="titlebar-tabs"] a[href="${href}"]`, visible: false },
      },
      navigate: async () => {
        await close.click()
        await expect(page).toHaveURL("/")
      },
    })
    report(result)
  })
})

// FORK: `reviewDiffs` 必须显式给 —— 「stages the review body after cold session content」要断言
//   review 面板最终可见,而 review 面板只在 mock 提供了 vcs diff 时才渲染。原来 setup 不传 vcsDiff,
//   于是 review 永远不出现、断言必红(REQ-117 A 族根因,与冷启动耗时无关)。2026-08-18 [feat: voice-preclear-batch]
async function setup(
  page: Parameters<typeof mockStressTimeline>[0],
  sessionIDs: string[],
  options?: { reviewDiffs?: boolean },
) {
  await mockStressTimeline(page, options?.reviewDiffs ? { vcsDiff: createReviewDiffs() } : undefined)
  await installTimelineSettings(page)
  await installStressSessionTabs(page, { sessionIDs })
}

function messageSelector(id: string) {
  return `[data-message-id="${id}"]`
}
