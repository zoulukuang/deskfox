// FORK: REQ-098 share 分享页 e2e 的独立 playwright 配置 [feat: chat-tilde-del-fix] 2026-08-08
//
// 为什么单独一份配置(不并进 playwright.config.ts):
//   share 页跑的是 packages/web 的 Astro 服务 + 一个假后端,启动 ~30s;并进主配置会让每次
//   跑聊天页 e2e 都白等两个多余的 server。这条独立跑:
//     bun run --cwd packages/app test:e2e:web-share
//
// 文件名带 .deskfox:pre-commit 黑名单拦 *.config.ts(护上游配置),
//   EXCEPTION 放行 *.deskfox.config.ts —— fork 自有配置的既定命名约定。
//
// 为什么测试文件放 packages/app 而不是 packages/web:
//   packages/web 在 pre-commit 路径黑名单里,且没有任何测试基建(无 test 脚本、无 playwright 依赖);
//   放这里可以直接复用 app 已有的 @playwright/test,零新增依赖、不动 bun.lock、不多耗一笔 R4 override。
//
// 为什么 spec 放 e2e-web-share/ 而不是 e2e/web-share/:
//   主配置 playwright.config.ts 的 testDir 是 ./e2e,会连带扫到这条 spec —— 它需要额外两个
//   server,在主配置下裸跑必挂(pre-push 跑 e2e 时同样会炸)。挪出 e2e/ 即可,免去改
//   playwright.config.ts(那个文件在 pre-commit 黑名单,动它要多耗一笔 R4 override)。
import { defineConfig, devices } from "@playwright/test"

const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 4320)
const apiPort = Number(process.env.PLAYWRIGHT_SHARE_API_PORT ?? 4322)
const baseURL = `http://127.0.0.1:${webPort}`

export default defineConfig({
  testDir: "./e2e-web-share",
  outputDir: "./e2e-web-share/test-results",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["line"]],
  webServer: [
    {
      // SSR 阶段的 /share_data 假后端(浏览器侧拦不到,必须真起)
      command: `bun e2e/utils/share-fixture-server.ts ${apiPort}`,
      url: `http://127.0.0.1:${apiPort}/share_data?id=probe`,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    },
    {
      // packages/web 的 Astro dev;VITE_API_URL 指向假后端
      command: `bun run dev --port ${webPort}`,
      cwd: "../web",
      // 站点根是 /docs(starlight),根路径返回 404 → 用真存在的分享页当就绪探针
      url: baseURL + "/docs/s/ses_share_tilde",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        VITE_API_URL: `http://127.0.0.1:${apiPort}`,
        // ⚠️ 必须清代理:astro 的 SSR 跑在 Cloudflare adapter 的 wrangler/workerd 里,它认 HTTP(S)_PROXY;
        //   本机 Clash 常驻(~/.zshenv 里全局设了代理)会把 127.0.0.1 的请求也劫走 → 表现为
        //   `fetch failed / other side closed`(假后端根本收不到请求),页面 500。
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        http_proxy: "",
        https_proxy: "",
        all_proxy: "",
        NO_PROXY: "127.0.0.1,localhost",
      },
    },
  ],
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
