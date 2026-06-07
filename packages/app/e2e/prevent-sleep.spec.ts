// FORK: 防休眠开关 Phase 1 mock e2e [feat: prevent-sleep] 2026-06-06
//
// 覆盖 spec B1/B2:飞书设置页「保持电脑不休眠」开关出现、初始关闭、点击开启
// (mock get_prevent_sleep / set_prevent_sleep 闭环)。
// B3(托盘 event 同步)不在 Phase 1 范围:vite mock 只 alias core 不 alias event,
// 前端 listen 已加 .catch 静默降级;本 spec 第 2 条验证无 fatal console error 佐证降级生效。
//
// 默认 locale fallback en(无 user config),故断言英文文案:
//   设置按钮 "Settings" / 飞书 tab "Lark Bridge" / 开关标题 "Keep computer awake"

import { test, expect, bootstrapMock } from "./fixtures"
import type { Page } from "@playwright/test"

async function openFeishuSettings(page: Page): Promise<void> {
  await bootstrapMock(page)
  await page.goto("/")
  await page.waitForLoadState("domcontentloaded")
  await page.waitForTimeout(2000) // SolidJS hydrate
  // sidebar 设置齿轮(IconButton aria-label=sidebar.settings)→ 打开设置弹窗
  await page.getByRole("button", { name: "Settings" }).first().click()
  // 切到飞书桥接 tab(Kobalte Tabs.Trigger role=tab)
  await page.getByRole("tab", { name: "Lark Bridge" }).click()
}

test("防休眠开关:飞书设置页出现、初始关闭、点击可开启", async ({ mockedPage: page }) => {
  await openFeishuSettings(page)

  // 标题文案可见(开关块在标题区下方,不受 adapter 未就绪影响)
  await expect(page.getByText("Keep computer awake")).toBeVisible()

  // 飞书 tab 内唯一的 switch = 防休眠;初始关闭(mock get_prevent_sleep 返 false)
  const sw = page.getByRole("switch").first()
  await expect(sw).toBeVisible()
  await expect(sw).not.toBeChecked()

  // 点击 → 开启(onChange → invoke set_prevent_sleep → mock 状态置 true → UI 反映)
  // Kobalte Switch:role=switch 在隐藏 input 上、被 thumb 覆盖拦截 pointer,点可见的 control 区域
  await page.locator('[data-slot="switch-control"]').first().click()
  await expect(sw).toBeChecked()
})

test("防休眠:listen 降级无 fatal console error(mock 无 event API)", async ({ mockedPage: page }) => {
  const errors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`)
  })

  await openFeishuSettings(page)
  await expect(page.getByText("Keep computer awake")).toBeVisible()
  await page.waitForTimeout(500) // 给 listen .catch 降级留时间

  // 严格 0 fatal error — 验证 import("@tauri-apps/api/event") + listen 的 .catch 兜住了
  expect(errors).toEqual([])
})
