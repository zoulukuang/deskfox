// FORK: CDP 真机 harness(L3)—— 连「真·本地版 Electron app」的渲染进程驱动 DOM。
//   零 TCC、真实数据/真实文件树,适合 mock 难造的场景(文件树多选、原生对话框旁路)。
//   不进 CI(需 app 在跑 + 调试端口);定位为 L3 真机冒烟,与 L2 mock harness 互补。
//   背景见 OPENCODE-PLAN 协作方案/前端自动化测试-工具与方法论.md §二/§九。
//
// 前提:本地版带远程调试端口启动(见同目录 README.md):
//   "/…/DeskFox 本地版.app/Contents/MacOS/DeskFox 本地版" --remote-debugging-port=9222
import { createRequire } from "module"

// 从 packages/app/ 解析 playwright-core(monorepo 提升/.bun 都能命中)
const appPkg = new URL("../../", import.meta.url).pathname // → packages/app/
const require = createRequire(appPkg)

export async function connectApp(port = Number(process.env.CDP_PORT ?? 9222)) {
  const { chromium } = require("playwright-core")
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const ctx = browser.contexts()[0]
  if (!ctx) throw new Error(`CDP 连上了但没有 context(app 在跑吗?端口 ${port})`)
  // 渲染页是 oc://renderer/...;桌面端用 MemoryRouter,不能 page.goto,只能 DOM 点击
  const page = ctx.pages().find((p) => p.url().startsWith("oc://")) ?? ctx.pages()[0]
  if (!page) throw new Error("CDP 连上了但没有渲染页面")
  await page.bringToFront().catch(() => {})
  return { browser, page }
}

// Cmd(mac)/Ctrl 多选点击一个元素(OS-like toggle)
export async function modifierClick(page, locator) {
  const mod = process.platform === "darwin" ? "Meta" : "Control"
  await page.keyboard.down(mod)
  await locator.click()
  await page.keyboard.up(mod)
}
