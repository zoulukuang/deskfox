// FORK: REQ-052 [feat: v2026.8.3 供应商列表实时刷新] —— L2 回归 spec
//   验证:settings-v2 Providers 面板能正确渲染来自 mock /provider 的已连接供应商列表。
//   覆盖路径:useProviders().connected() ← providers() ← child store / globalStore,
//   即 refreshProviders() 失效后重取的同一数据管线。
//   data-* 断言优先:connected-providers-section / provider row;locale 已钉 en-US。
//   备注:本 spec 在 mock-server 层验证数据渲染路径,不模拟真实 auth.set 网络调用
//   (那需要真 sidecar),断言聚焦「有已连接 provider 时列表显示且断开按钮可用」。
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { makeProject, makeProvider, makeSession } from "../utils/fixtures"

const directory = "C:/OpenCode/ProvidersRefreshREQ052"
const projectID = "proj_providers_refresh_052"
const sessionID = "ses_providers_refresh_052"
const title = "Providers refresh regression"

// Mock provider data: anthropic connected (走 B 路径的典型普通 provider)
function makeProviderWithAnthropic() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
      {
        id: "anthropic",
        name: "Anthropic",
        source: "api",
        env: [],
        options: {},
        models: {
          "claude-3-5-sonnet-20241022": {
            id: "claude-3-5-sonnet-20241022",
            name: "Claude 3.5 Sonnet",
            limit: { context: 200_000 },
            cost: { input: 3, output: 15 },
          },
        },
      },
    ],
    connected: ["opencode", "anthropic"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  }
}

test.describe("regression: providers list renders connected providers (REQ-052 v2026.8.3)", () => {
  test("connected-providers-section shows anthropic row with disconnect button", async ({ page }) => {
    await enableNewLayout(page)
    await mockOpenCodeServer(page, {
      directory,
      project: makeProject({ id: projectID, directory, name: title }),
      provider: makeProviderWithAnthropic(),
      sessions: [makeSession({ id: sessionID, projectID, directory, title })],
      pageMessages: () => ({ items: [] }),
      events: () => [],
    })

    // 导航到 home 页,通过 Settings 按钮打开设置面板(v2 home page 路径)
    await page.goto("/")

    // 等待 home 页 v2 UI 出现(settings 按钮在 home 导航区)
    const settingsBtn = page.getByRole("button", { name: "Settings", exact: true }).first()
    await settingsBtn.waitFor({ state: "visible", timeout: 20_000 })
    await settingsBtn.click()

    // 等设置对话框打开(settings-v2 走 dialog-v2 组件)
    const settingsDialog = page.locator('[data-component="dialog-v2"]').first()
    await settingsDialog.waitFor({ state: "visible", timeout: 10_000 })

    // 点 Providers tab
    const providersTab = page.getByRole("tab", { name: "Providers", exact: true }).first()
    await providersTab.waitFor({ state: "visible", timeout: 5_000 })
    await providersTab.click()

    // 已连接供应商区域可见
    const connectedSection = page.locator('[data-component="connected-providers-section"]').first()
    await connectedSection.waitFor({ state: "visible", timeout: 8_000 })

    // Anthropic 行可见(用 provider name 文案,locale 已钉 en-US)
    const anthropicRow = connectedSection.getByText("Anthropic", { exact: false }).first()
    await anthropicRow.waitFor({ state: "visible", timeout: 5_000 })

    // 断开按钮可用(验证 canDisconnect=true 且 source=api)
    const disconnectBtn = connectedSection.getByRole("button", { name: "Disconnect", exact: true }).first()
    await expect(disconnectBtn).toBeVisible()
  })

  test("connected-providers-section shows empty state when no providers connected", async ({ page }) => {
    await enableNewLayout(page)
    await mockOpenCodeServer(page, {
      directory,
      project: makeProject({ id: projectID, directory, name: title }),
      // opencode provider 没有付费模型(cost.input 未定义),connected 列表渲染为空
      provider: makeProvider(),
      sessions: [makeSession({ id: sessionID, projectID, directory, title })],
      pageMessages: () => ({ items: [] }),
      events: () => [],
    })

    await page.goto("/")

    const settingsBtn = page.getByRole("button", { name: "Settings", exact: true }).first()
    await settingsBtn.waitFor({ state: "visible", timeout: 20_000 })
    await settingsBtn.click()

    const settingsDialog = page.locator('[data-component="dialog-v2"]').first()
    await settingsDialog.waitFor({ state: "visible", timeout: 10_000 })

    const providersTab = page.getByRole("tab", { name: "Providers", exact: true }).first()
    await providersTab.waitFor({ state: "visible", timeout: 5_000 })
    await providersTab.click()

    const connectedSection = page.locator('[data-component="connected-providers-section"]').first()
    await connectedSection.waitFor({ state: "visible", timeout: 8_000 })

    // 空态文案出现(locale en-US: "No connected providers")
    await expect(
      connectedSection.getByText("No connected providers", { exact: false }).first(),
    ).toBeVisible({ timeout: 8_000 })
  })
})

async function enableNewLayout(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true } }),
    )
  })
}
