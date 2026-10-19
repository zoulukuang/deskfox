import config from "./playwright.config"

// FORK: release acceptance freezes source watching while preserving the existing fixture contract. 2026-10-19
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4319)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`

export default {
  ...config,
  retries: 0,
  use: {
    ...config.use,
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    ...config.webServer,
    url: baseURL,
    command: `bun run dev -- --config vite.release.deskfox.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    reuseExistingServer: false,
  },
}
