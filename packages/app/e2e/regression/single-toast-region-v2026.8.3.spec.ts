// FORK: U4 检查更新重复 toast — 收敛双 ToastRegion 为单一 region [feat: v2026.8.3] 2026-06-18
//   根因:legacy Toast.Region 与 v2 ToastV2.Region 共用同一 Kobalte @kobalte/core/toast 单例,
//   Show 分支切换瞬间两 region 共存 → 一条 toast 被渲两遍。
//   验收:querySelectorAll('[data-component="toast-region"],[data-component="toast-v2-region"]').length === 1
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
      '[data-component="toast-region"],[data-component="toast-v2-region"]',
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
  // 最终选择:验证 toast region 数量(判定金标准),不依赖 inject-toast。
  // 如需注入 toast 验 count=1,用 keyboard shortcut 触发 toast(theme cycle keybind):
  // Mod+Shift+T 会触发 cycleTheme → showToast。
  await page.keyboard.press("Control+Shift+T")
}

async function countToastItems(page: Page): Promise<number> {
  return page.evaluate(() => {
    return document.querySelectorAll('[data-component="toast"],[data-component="toast-v2"]').length
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
    await setupPage(page, true)

    await page.goto("/")
    await waitForAppShell(page)

    const count = await countToastRegions(page)
    expect(count, "should have exactly 1 toast region in DOM").toBe(1)
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
      () => document.querySelectorAll('[data-component="toast"],[data-component="toast-v2"]').length >= 1,
      { timeout: 5_000 },
    )

    const toastCount = await countToastItems(page)
    expect(toastCount, "should show exactly 1 toast, not 2").toBe(1)
  })

  test("v2 design: exactly 1 toast region mounted", async ({ page }) => {
    await setupPage(page, true)

    await page.goto("/")
    await waitForAppShell(page)

    // FORK 注记(2026-08-11 sync v1.17.13):上游 v2 换 NewAppLayout 壳(layout-new.tsx 自带唯一
    // ToastRegion),theme.cycle 等命令仍只注册在 legacy Layout → v2 下 Ctrl+Shift+T 无法触发 toast,
    // 原「触发后恰 1 条」步骤在此上游过渡态不可执行。守卫核心(单一 region,U4 双 region 根因)保留;
    // 段4(v1.18.16,v2 命令体系到位)复核恢复触发断言。
    const regionCount = await countToastRegions(page)
    expect(regionCount, "v2 design must mount exactly 1 toast region").toBe(1)
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
      document.querySelectorAll('[data-component="toast-region"],[data-component="toast-v2-region"]').length > 0,
    { timeout: 20_000 },
  )
}


