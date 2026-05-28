// FORK: Tauri CDP smoke — 验证 connectOverCDP + DeskFox.exe 链路通 + DOM 可探查 2026-05-07

import { test, expect } from "../fixtures"

test("DeskFox 启动后 CDP 连得上,WebView 内 SolidJS UI 渲染出来", async ({ deskfoxApp }) => {
  const { page } = deskfoxApp

  // CDP 连成功 → page 来自 DeskFox 主窗口
  expect(page).toBeTruthy()
  expect(page.url()).toContain("tauri.localhost")

  // body 应该有渲染内容(sidebar.empty 状态 + getting started 文案)
  const body = page.locator("body")
  await expect(body).toBeVisible()

  // Solid Portal 把 dialog 等渲到 body 外的 portal,innerText 可能 0;用 innerHTML 测真实渲染
  const html = await body.innerHTML()
  console.log(`[smoke-cdp] body innerHTML length: ${html.length}`)

  // 标题应是 DeskFox
  const title = await page.title()
  console.log(`[smoke-cdp] page title: ${title}`)

  // 真实渲染 → innerHTML 应 > 1k
  expect(html.length).toBeGreaterThan(1000)
})

test("dump 关键 selector — 文件树 / open project 按钮 / sidebar", async ({ deskfoxApp }) => {
  const { page } = deskfoxApp

  // 找按钮们
  const buttons = page.locator("button")
  const btnCount = await buttons.count()
  console.log(`[probe] button count: ${btnCount}`)
  for (let i = 0; i < Math.min(btnCount, 20); i++) {
    const text = await buttons.nth(i).innerText().catch(() => "")
    const ariaLabel = await buttons.nth(i).getAttribute("aria-label").catch(() => null)
    console.log(`  [btn ${i}] text="${text.slice(0, 40).replace(/\n/g, "↵")}" aria-label="${ariaLabel ?? ""}"`)
  }

  // 找 sidebar / nav
  const navText = await page.locator("nav, [role='navigation']").first().innerText().catch(() => "")
  console.log(`[probe] nav text:\n${navText.slice(0, 400)}`)

  // dump head section HTML 看 SolidJS 结构
  const rootHtml = await page.locator("body").innerHTML()
  console.log(`[probe] body innerHTML length: ${rootHtml.length}`)
})
