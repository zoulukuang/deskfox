// FORK: U4 检查更新重复 toast — 收敛双 ToastRegion 为单一 region [feat: v2026.8.3] 2026-06-18
//   根因:legacy Toast.Region 与 v2 ToastV2.Region 共用同一 Kobalte @kobalte/core/toast 单例,
//   Show 分支切换瞬间两 region 共存 → 一条 toast 被渲两遍。
//   验收:querySelectorAll('[data-component="toast-region"],.toast-v2-region').length === 1
//   且触发一条 showToast 后 [data-component="toast"].length === 1。
//   两个 design-mode 分支(legacy v1 / newDesign v2)均验。locale 已钉 en-US。
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { makeProject, makeProvider, makeSession } from "../utils/fixtures"

const directory = "C:/OpenCode/SingleToastRegion_U4"
const projectID = "proj_toast_region_u4"
const sessionID = "ses_toast_region_u4"
const title = "Single toast region regression"
const TOAST_TITLE = "U4_TOAST_DEDUP_MARKER"

/** 注入一条 toast,调用 showToast 并返回 toast id(undefined = 函数未挂载)。
 *  app 在 window.__showToast 上没有全局暴露点,用 Kobalte toaster 直接打;
 *  这里走最可靠的方案:通过 CDP evaluate 操作 DOM toaster 触发,
 *  或检查 ToastRegion 数量(纯 DOM 断言,不依赖内部 API)。 */
async function countToastRegions(page: Page): Promise<number> {
  return page.evaluate(() => {
    return document.querySelectorAll(
      '[data-component="toast-region"],.toast-v2-region',
    ).length
  })
}

async function triggerShowToastViaEvaluate(page: Page, title: string): Promise<void> {
  // 通过 Kobalte 的 DOM toaster 接口注入 toast:
  // layout.tsx 在 window 上没暴露 showToast,改走 CustomEvent 触发路径,
  // 或直接 evaluate 调用模块内 showToast。
  // 实际最可靠的做法:直接构造 toast DOM(Kobalte 从 store 渲染),
  // 但 store 是模块级单例,eval 无法直接访问。
  //
  // 替代:通过 window.__test_showToast 注入(在 mock-server setup 中注入),
  // 或通过 page.addInitScript 暴露。本 spec 走 initScript 方式:
  // layout.tsx 的 showToast 绑在模块内,eval 里无法引用。
  //
  // 2026-08-11 sync v1.18.16:v2 下 mod+shift+t 被上游改绑 reopenClosedTab,键触发失效;
  // 改走 utils/toast.tsx 的 DEV 测试入口 __deskfoxShowToast(与布局无关,直接打应用层 showToast)
  await page.evaluate((t) => {
    const fn = (window as unknown as { __deskfoxShowToast?: (o: { title: string }) => void }).__deskfoxShowToast
    if (!fn) throw new Error("__deskfoxShowToast 未挂载(DEV 入口缺失)")
    fn({ title: t })
  }, title)
}

async function countToastItems(page: Page): Promise<number> {
  return page.evaluate(() => {
    return document.querySelectorAll('[data-component="toast"],.toast-v2-region .toast-v2').length
  })
}

test.describe("regression: single toast region — no duplicate update toast (U4 v2026.8.3)", () => {
  test("legacy design: exactly 1 toast region in DOM", async ({ page }) => {
    // legacy design(newDesign=false,默认)
    await setupPage(page, false)

    await page.goto("/")
    await waitForAppShell(page)

    const count = await countToastRegions(page)
    expect(count, "should have exactly 1 toast region in DOM").toBe(1)
  })

  test("v2 design: exactly 1 toast region in DOM", async ({ page }) => {
    // v2 design(newDesign=true)
    // 2026-08-11 sync v1.18.16:上游 toast-v2 换 sonner 风格 Toaster,region 惰性挂载(无 toast 时
    // 不在 DOM)→ 改为「触发一条后恰 1 region + 恰 1 条」,守卫语义与 U4 一致(无双 region 双弹)
    await setupPage(page, true)

    await page.goto("/")
    await page.waitForSelector("main", { timeout: 20_000 })

    await triggerShowToastViaEvaluate(page, TOAST_TITLE)
    await page.waitForFunction(
      () => document.querySelectorAll(".toast-v2-region .toast-v2").length >= 1,
      { timeout: 5_000 },
    )
    expect(await countToastRegions(page), "should have exactly 1 toast region in DOM").toBe(1)
    expect(await countToastItems(page), "should show exactly 1 toast, not 2").toBe(1)
  })

  test("legacy design: triggering a toast shows exactly 1 item", async ({ page }) => {
    await setupPage(page, false)

    await page.goto("/")
    await waitForAppShell(page)

    // 先确认 toast region 唯一
    const regionCount = await countToastRegions(page)
    expect(regionCount).toBe(1)

    // 通过 Ctrl+Shift+T 触发 cycleTheme → showToast(可靠的应用层 showToast 入口)
    await triggerShowToastViaEvaluate(page, TOAST_TITLE)

    // 等待至少 1 条 toast 出现
    await page.waitForFunction(
      () => document.querySelectorAll('[data-component="toast"],.toast-v2-region .toast-v2').length >= 1,
      { timeout: 5_000 },
    )

    const toastCount = await countToastItems(page)
    expect(toastCount, "should show exactly 1 toast, not 2").toBe(1)
  })

  test("v2 design: exactly 1 toast region mounted", async ({ page }) => {
    // 2026-08-11 sync v1.18.16:恢复触发断言(段2 注记的过渡态已随上游收敛);sonner region 惰性挂载,
    // 触发一条后断言恰 1 region + 恰 1 条
    await setupPage(page, true)

    await page.goto("/")
    await page.waitForSelector("main", { timeout: 20_000 })

    await triggerShowToastViaEvaluate(page, TOAST_TITLE)
    await page.waitForFunction(
      () => document.querySelectorAll(".toast-v2-region .toast-v2").length >= 1,
      { timeout: 5_000 },
    )
    expect(await countToastRegions(page), "v2 design must mount exactly 1 toast region").toBe(1)
    expect(await countToastItems(page), "should show exactly 1 toast, not 2").toBe(1)
  })
})

async function setupPage(page: Page, newLayout: boolean) {
  if (newLayout) {
    await page.addInitScript(() => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true } }),
      )
    })
  }

  await mockOpenCodeServer(page, {
    directory,
    project: makeProject({ id: projectID, directory, name: title }),
    provider: makeProvider(),
    sessions: [makeSession({ id: sessionID, projectID, directory, title })],
    pageMessages: () => ({ items: [] }),
    events: () => [],
  })
}

/** 等待 app shell 可见(toast region 已挂载) */
async function waitForAppShell(page: Page): Promise<void> {
  // 等待至少一个 toast region 挂载
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-component="toast-region"],.toast-v2-region').length > 0,
    { timeout: 20_000 },
  )
}


