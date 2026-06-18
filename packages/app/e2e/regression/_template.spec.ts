// FORK: L2 回归 spec 模板 —— 复制本文件改 3 处(directory/ids、mock 数据、断言)即出新用例。
//   它本身也是一条「harness 冒烟」:跑通即证明 playwright.config(端口/locale)+ fixtures + mock-server 正常。
//   写法约定见 OPENCODE-PLAN 协作方案/前端自动化测试-工具与方法论.md。
//
//   三步走:
//   1) 改 directory/sessionID/projectID 等常量(避免与别的 spec 撞)。
//   2) 在 mockServer() 里用 fixtures builder 拼出场景(项目/会话/消息 part/文件列表)。
//   3) 写断言 —— 优先 data-*/aria(如 [data-timeline-part-id]、[data-slot]、aria-expanded、
//      [data-component="toast"]、[data-tree-path]),文案选择器只在确需时用(locale 已钉 en-US)。
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"
import {
  assistantMessage,
  base64Encode,
  makeProject,
  makeProvider,
  makeSession,
  reasoningPart,
  textPart,
  userMessage,
} from "../utils/fixtures"

const directory = "C:/OpenCode/TemplateExample"
const projectID = "proj_template"
const sessionID = "ses_template"
const title = "Template example"
const answer = "TEMPLATE_ANSWER_MARKER"

test.describe("template: harness smoke (copy me)", () => {
  test("renders a session and shows the assistant answer", async ({ page }) => {
    await mockOpenCodeServer(page, {
      directory,
      project: makeProject({ id: projectID, directory, name: "template" }),
      provider: makeProvider(),
      sessions: [makeSession({ id: sessionID, projectID, directory, title })],
      pageMessages: () => ({
        items: [
          userMessage({ id: "msg_u_tpl", sessionID, text: "Please answer." }),
          assistantMessage({
            id: "msg_a_tpl",
            sessionID,
            parentID: "msg_u_tpl",
            parts: [reasoningPart("prt_r_tpl", "thinking..."), textPart("prt_t_tpl", answer)],
          }),
        ],
      }),
      events: () => [],
    })

    await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
    await expectSessionTitle(page, title)
    await expectAppVisible(page.getByText(answer, { exact: false }).first())
  })
})
