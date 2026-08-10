import { defineConfig, devices } from "@playwright/test"

// FORK: 默认端口避开 3000 —— 本机 vnpy 交易系统常驻 3000,reuseExistingServer 会误连它,
//   导致 e2e 全程跑在错误的 app 上(v2026.8.2 U6 头一次失败即此因)。改用专用冷门端口 4319;
//   仍可用 PLAYWRIGHT_PORT 覆盖。详见 OPENCODE-PLAN 协作方案/前端自动化测试-工具与方法论.md §一。2026-06-18
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4319)
// FORK: 回填 env —— mock-server.ts 的 appPort 兜底读 PLAYWRIGHT_PORT(缺省 3000);fork 改用
//   4319 后若不回填,相对路径 fetch(如 /global/health)会 route.fallback 落到 vite index.html
//   (上游 transport「passes through non-event fetches」e2e 实锤)。2026-08-11
process.env.PLAYWRIGHT_PORT ??= String(port)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
const command = `bun run dev -- --host 0.0.0.0 --port ${port}`
const reuse = !process.env.CI
const workers = Number(process.env.PLAYWRIGHT_WORKERS ?? (process.env.CI ? 5 : 0)) || undefined
export default defineConfig({
  testDir: "./e2e",
  testIgnore: process.env.OPENCODE_PERFORMANCE === "1" ? "performance/**/*.test.ts" : "performance/**",
  outputDir: "./e2e/test-results",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: process.env.PLAYWRIGHT_FULLY_PARALLEL === "1",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers,
  reporter: [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]],
  webServer: {
    command,
    url: baseURL,
    reuseExistingServer: reuse,
    timeout: 120_000,
    env: {
      VITE_OPENCODE_SERVER_HOST: serverHost,
      VITE_OPENCODE_SERVER_PORT: serverPort,
    },
  },
  use: {
    baseURL,
    // FORK: 固定 locale/时区 —— mock harness(web 构建)默认英文,但 CI 机器系统 locale 可能是
    //   中文/其他,会让 UI 文案漂移。钉死 en-US + UTC,断言里的英文文案/时间确定可复现。
    //   原则仍是「优先 data-*/aria,文案选择器只在 locale 固定后才确定」。2026-06-18
    locale: "en-US",
    timezoneId: "UTC",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
