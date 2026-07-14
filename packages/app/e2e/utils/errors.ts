import { expect, type Page } from "@playwright/test"

export function trackPageErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() !== "error") return
    const text = message.text()
    // FORK: 过滤纯资源加载失败(外链/favicon/telemetry 等连不上的网络噪音) —— fixture 带的外链
    // (如 example.com webfetch preview)在 e2e 环境经 mock-server route.fallback 放行到真实网络,
    // 连不上就报 "Failed to load resource: net::ERR_CONNECTION_REFUSED",让 smoke 对环境网络状态
    // 敏感而 flaky。这类非应用逻辑错误不该算 smoke 失败;真 JS 异常走 pageerror、应用错误有别的文本。
    // [bug-repro: session-timeline e2e 因外链 net::ERR_CONNECTION_REFUSED 偶发红]
    if (text.startsWith("Failed to load resource:")) return
    errors.push(text)
  })
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  return errors
}

export function expectNoSmokeErrors(consoleErrors: string[], toastErrors: string[], forbiddenText: string[]) {
  expect({ consoleErrors, toastErrors, forbiddenText }).toEqual({
    consoleErrors: [],
    toastErrors: [],
    forbiddenText: [],
  })
}
