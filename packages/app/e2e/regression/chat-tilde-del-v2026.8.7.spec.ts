// FORK: REQ-098 [feat: chat-tilde-del-fix] —— E2E 回归:聊天正文里的数值区间不得被渲染成删除线。
//  GFM 内置 del 定界符是 `~~?`(一或两个 ~),同一行两个「数字~数字」区间会把中间整段闭成 <del>
//  (4.80~5.05 … 5.20~5.35 → "4.80<del>5.05 … 5.20</del>5.35"),金融/数值回复里高频。
//  这里走【真实渲染链路】(mock server → session 时间线 → ui/context/marked.tsx 的 jsParser),
//  断言 DOM 里没有 <del>、区间文本完整;同时验 `~~删除~~` 仍正常(不回归)。
//  模板取自 reasoning-fold-v2026.8.2.spec.ts。
import { expect, test, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { assistantMessage, base64Encode, makeProject, makeProvider, makeSession, textPart, userMessage } from "../utils/fixtures"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/TildeDelV2026_8_7"
const projectID = "proj_tilde_del"
const sessionID = "ses_tilde_del"
const title = "Tilde del regression"

// 真正会触发的形态:同一行两个「数字~数字」区间(单区间修前就不会被划,当用例无效)
const RANGE_TEXT = "预计在 4.80~5.05 区间内震荡,突破 5.20~5.35 的概率低"
const PERCENT_TEXT = "波动 0.5%~1.2%,回撤 3%~5%"
// 不回归:标准 GFM 删除线仍要产出 <del>
const STRIKE_TEXT = "~~这段确实要划掉~~"

const project = makeProject({ id: projectID, directory, name: "tilde-del" })
const session = makeSession({ id: sessionID, projectID, directory, title })

const user = userMessage({ id: "msg_user_tilde", sessionID, text: "给个区间预测" })
const assistant = assistantMessage({
  id: "msg_assistant_tilde",
  sessionID,
  parentID: user.info.id,
  parts: [
    textPart("prt_range", RANGE_TEXT),
    textPart("prt_percent", PERCENT_TEXT),
    textPart("prt_strike", STRIKE_TEXT),
  ],
})

test.describe("regression: 单波浪号误判删除线 (REQ-098)", () => {
  test("数值区间不被划掉,标准 ~~删除~~ 仍生效", async ({ page }) => {
    await mockServer(page)

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const rangePart = page.locator('[data-timeline-part-id="prt_range"]').first()
    await expectAppVisible(rangePart)

    // ① 两个数值区间的那段:整段渲染结果里不得出现 <del>
    const rangeHtml = await rangePart.innerHTML()
    expect(rangeHtml).not.toContain("<del>")

    // ② 区间文本完整保留(波浪号没被吃掉)
    const rangeText = (await rangePart.innerText()).replace(/\s+/g, " ")
    expect(rangeText).toContain("4.80~5.05")
    expect(rangeText).toContain("5.20~5.35")

    // ③ 百分比区间同理
    const percentPart = page.locator('[data-timeline-part-id="prt_percent"]').first()
    await expectAppVisible(percentPart)
    expect(await percentPart.innerHTML()).not.toContain("<del>")
    const percentText = (await percentPart.innerText()).replace(/\s+/g, " ")
    expect(percentText).toContain("0.5%~1.2%")
    expect(percentText).toContain("3%~5%")

    // ④ 不回归:标准 GFM `~~...~~` 仍渲染成 <del>
    const strikePart = page.locator('[data-timeline-part-id="prt_strike"]').first()
    await expectAppVisible(strikePart)
    expect(await strikePart.innerHTML()).toContain("<del>")
    expect(await strikePart.innerText()).toContain("这段确实要划掉")

    // ⑤ 整页兜底:除了那条真删除线,不应再有别的 <del>
    const delCount = await page.locator('[data-component="markdown"] del, [data-timeline-part-id] del').count()
    expect(delCount).toBe(1)
  })
})

async function mockServer(page: Page) {
  await mockOpenCodeServer(page, {
    provider: makeProvider(),
    directory,
    project,
    sessions: [session],
    pageMessages: () => ({ items: [user, assistant] }),
  })
}
