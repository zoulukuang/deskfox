// FORK: REQ-054 [feat: v2026.8.3 自定义供应商模型列表同步] —— L2 回归 spec
//   验证:settings-v2 Providers 面板在 GetBot 已连接时显示「刷新模型」按钮。
//   覆盖路径:SettingsProvidersV2 → connected provider row → item.id === "getbot" → Show → ButtonV2
//   data-* 断言优先:[data-component="getbot-refresh-models"]、[data-provider-id="getbot"];
//   locale 已钉 en-US。
//   备注:本 spec 在 mock-server 层验证 UI 渲染路径,不调用真实 GetBot API(那需要真 sidecar)。
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { makeProject, makeProvider, makeSession } from "../utils/fixtures"

const directory = "C:/OpenCode/GetbotRefreshREQ054"
const projectID = "proj_getbot_refresh_054"
const sessionID = "ses_getbot_refresh_054"
const title = "GetBot refresh models regression"

// Mock GetBot 已连接的 provider 数据
function makeProviderWithGetbot() {
  return {
    all: [
      {
        id: "opencode",
        name: "OpenCode",
        models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
      },
      {
        id: "getbot",
        name: "GetBot",
        source: "config",
        env: [],
        options: { baseURL: "https://api.getbot.me/v1", apiKey: "test-key" },
        models: {
          "gpt-4o": { name: "gpt-4o", tool_call: true, attachment: true },
          "deepseek-v3": { name: "deepseek-v3", tool_call: true },
          "qwen-plus": { name: "qwen-plus", tool_call: true },
        },
      },
    ],
    connected: ["opencode", "getbot"],
    default: { providerID: "opencode", modelID: "claude-opus-4-6" },
  }
}

test.describe("regression: GetBot 刷新模型按钮在 Providers 面板可见 (REQ-054 v2026.8.3)", () => {
  test("connected GetBot row shows refresh-models button with data-component anchor", async ({ page }) => {
    await enableNewLayout(page)
    await mockOpenCodeServer(page, {
      directory,
      project: makeProject({ id: projectID, directory, name: title }),
      provider: makeProviderWithGetbot(),
      sessions: [makeSession({ id: sessionID, projectID, directory, title })],
      pageMessages: () => ({ items: [] }),
      events: () => [],
    })

    await page.goto("/")

    // 等待 home 页 v2 UI 出现
    const settingsBtn = page.getByRole("button", { name: "Settings", exact: true }).first()
    await settingsBtn.waitFor({ state: "visible", timeout: 20_000 })
    await settingsBtn.click()

    // 等设置对话框打开
    const settingsDialog = page.locator('[data-component="dialog-v2"]').first()
    await settingsDialog.waitFor({ state: "visible", timeout: 10_000 })

    // 点 Providers tab
    const providersTab = page.getByRole("tab", { name: "Providers", exact: true }).first()
    await providersTab.waitFor({ state: "visible", timeout: 5_000 })
    await providersTab.click()

    // 已连接供应商区域可见
    const connectedSection = page.locator('[data-component="connected-providers-section"]').first()
    await connectedSection.waitFor({ state: "visible", timeout: 8_000 })

    // GetBot 行可见(用 data-provider-id 锚点)
    const getbotRow = connectedSection.locator('[data-provider-id="getbot"]').first()
    await getbotRow.waitFor({ state: "visible", timeout: 5_000 })

    // 「刷新模型」按钮可见(data-component="getbot-refresh-models" 是关键断言)
    const refreshBtn = getbotRow.locator('[data-component="getbot-refresh-models"]').first()
    await expect(refreshBtn).toBeVisible({ timeout: 5_000 })
    await expect(refreshBtn).toBeEnabled()

    // 按钮文案为 "Refresh models"(en-US locale)
    await expect(refreshBtn).toContainText("Refresh models")
  })

  test("non-GetBot provider row does NOT show refresh-models button", async ({ page }) => {
    await enableNewLayout(page)

    // 只连 anthropic,不连 getbot
    const providerData = {
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

    await mockOpenCodeServer(page, {
      directory,
      project: makeProject({ id: projectID, directory, name: title }),
      provider: providerData,
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

    // anthropic 行可见
    const anthropicRow = connectedSection.locator('[data-provider-id="anthropic"]').first()
    await anthropicRow.waitFor({ state: "visible", timeout: 5_000 })

    // anthropic 行不显示刷新模型按钮
    await expect(anthropicRow.locator('[data-component="getbot-refresh-models"]')).not.toBeVisible()
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
