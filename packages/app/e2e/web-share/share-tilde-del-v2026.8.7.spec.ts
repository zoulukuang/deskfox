// FORK: REQ-098 [feat: chat-tilde-del-fix] —— share 分享页(packages/web)的界面回归:
//  分享页与桌面聊天页是**两份独立的 marked 实例**(marked.use 只作用于各自模块),改一处不传导,
//  所以两边都要有断言。这条走真浏览器渲染真 Astro 页面:
//    · SSR 的 `/share_data` 由 e2e/utils/share-fixture-server.ts 提供
//    · 正文消息由 WebSocket 推送 → 这里用 Playwright routeWebSocket 直接 mock
//      (Share.tsx 把 URL 强制成 wss://,真起 WS 服务就得配自签 TLS,得不偿失)
import { expect, test } from "@playwright/test"
import { RANGE_TEXT, SHARE_FIXTURE, STRIKE_TEXT, shareFrames } from "../utils/share-fixture"

test.describe("regression: share 分享页单波浪号误判删除线 (REQ-098)", () => {
  test("数值区间不被划掉,标准 ~~删除~~ 仍生效", async ({ page }) => {
    // Share.tsx: wsUrl = apiUrl.replace(/^https?:\/\//, "wss://") + "/share_poll?id=..."
    await page.routeWebSocket(/\/share_poll/, (ws) => {
      for (const frame of shareFrames()) ws.send(frame)
    })

    await page.goto(`/docs/s/${SHARE_FIXTURE.info.id}`) // 站点 base 是 /docs;裸 /s/<id> 在 Accept: text/html 下 404

    const markdown = page.locator('[data-component="assistant-text-markdown"]')
    await expect(markdown.first()).toBeVisible({ timeout: 30_000 })

    // ① 两个数值区间那段:不得出现 <del>
    const rangeBlock = markdown.filter({ hasText: "4.80" }).first()
    await expect(rangeBlock).toBeVisible()
    expect(await rangeBlock.innerHTML()).not.toContain("<del>")

    // ② 区间文本完整保留(波浪号没被吃掉)
    const rangeText = (await rangeBlock.innerText()).replace(/\s+/g, " ")
    expect(rangeText).toContain("4.80~5.05")
    expect(rangeText).toContain("5.20~5.35")
    expect(RANGE_TEXT).toContain("4.80~5.05") // fixture 自证:用的就是会触发 bug 的形态

    // ③ 不回归:标准 GFM `~~...~~` 仍渲染成 <del>
    const strikeBlock = markdown.filter({ hasText: "这段确实要划掉" }).first()
    await expect(strikeBlock).toBeVisible()
    expect(await strikeBlock.innerHTML()).toContain("<del>")
    expect(STRIKE_TEXT).toContain("~~")

    // ④ 整页兜底:除了那条真删除线,不应再有别的 <del>
    expect(await page.locator("del").count()).toBe(1)
  })
})
