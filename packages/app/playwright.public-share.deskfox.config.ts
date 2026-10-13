import { defineConfig, devices } from "@playwright/test"

const port = process.env.SHARE_BROWSER_PORT ?? "4410"
const baseURL = `http://127.0.0.1:${port}`
export default defineConfig({
  testDir: "./e2e-public-share",
  outputDir: "./e2e-public-share/test-results",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["line"]],
  webServer: {
    command: "bun test/deskfox/browser-server.ts",
    cwd: "../enterprise",
    url: `${baseURL}/api/share/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { SHARE_BROWSER_PORT: port },
  },
  use: { baseURL, screenshot: "only-on-failure", locale: "en-US", timezoneId: "UTC" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
})
