// FORK: chat-loop user flow e2e — Phase 1 mock mode
// [feat: e2e-chat-loop] 2026-05-29
// 3 case 覆盖聊天主循环:发消息→user msg→assistant 回复 / sidebar 新 session 出现 / busy 期 progress 显示
import { test, expect, installServerMock, bootstrapMock } from "./fixtures"
import {
  mockChatSSE,
  buildChatFlowEvents,
  createMockSession,
  createMockUserMessage,
  createMockAssistantMessage,
  createMockTextPart,
} from "./mocks/chat-mock"

const DIRECTORY = "/mock/workspace"

async function enterWorkspace(page: import("@playwright/test").Page) {
  const card = page.locator(`text="/mock/workspace"`).first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await page.waitForTimeout(2500)
}

async function submitPrompt(page: import("@playwright/test").Page, text: string) {
  const input = page.locator('[data-component="prompt-input"]')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.click()
  await input.pressSequentially(text, { delay: 20 })
  await page.waitForTimeout(100)
  const submitBtn = page.locator('[data-action="prompt-submit"]')
  await expect(submitBtn).toBeVisible()
  await submitBtn.click()
}

async function waitForUserMessage(page: import("@playwright/test").Page, text: string) {
  await page.waitForFunction(
    (t) => {
      const turns = document.querySelectorAll('[data-component="session-turn"]')
      for (const turn of turns) {
        if (turn.textContent?.includes(t)) return true
      }
      return false
    },
    text,
    { timeout: 15_000 },
  )
}

async function waitForAssistantResponse(page: import("@playwright/test").Page, text: string) {
  await page.waitForFunction(
    (t) => {
      const containers = document.querySelectorAll('[data-slot="session-turn-assistant-content"]')
      for (const c of containers) {
        if (c.textContent?.includes(t)) return true
      }
      return false
    },
    text,
    { timeout: 15_000 },
  )
}

test.describe("Chat Loop — User Flow E2E", () => {
  test("C1 — new session: send message → see user msg → receive AI response", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(`PAGE: ${e.message}`))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`CONSOLE: ${msg.text()}`)
    })

    await installServerMock(page)
    await bootstrapMock(page, {
      projects: [
        { id: "e2e-mock-project", worktree: DIRECTORY, vcs: undefined, time: { created: Date.now() } },
      ],
    })
    const chatHandle = await mockChatSSE(page)

    await page.goto("/")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(3000)

    await enterWorkspace(page)
    await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()

    await submitPrompt(page, "Hello AI")
    await page.waitForTimeout(500)
    expect(page.url()).toContain("/session/")

    await waitForUserMessage(page, "Hello AI")

    const userMessageID = "msg_user_cloop001"
    const assistantMessageID = "msg_assistant_cloop001"
    const partID = "part_text_cloop001"

    await chatHandle.pushEvents(
      buildChatFlowEvents({
        sessionID: chatHandle.sessionID,
        directory: DIRECTORY,
        session: createMockSession({ sessionID: chatHandle.sessionID, directory: DIRECTORY }),
        userMessageID,
        userMessage: createMockUserMessage(chatHandle.sessionID, userMessageID, "code"),
        assistantMessageID,
        assistantMessage: createMockAssistantMessage(
          chatHandle.sessionID,
          assistantMessageID,
          "mock-provider",
          "mock-model",
          userMessageID,
        ),
        assistantParts: [
          createMockTextPart(chatHandle.sessionID, assistantMessageID, partID, "Hi! How can I help?"),
        ],
      }),
    )

    await waitForAssistantResponse(page, "Hi! How can I help?")

    expect(await page.locator('[data-component="session-turn"]').count()).toBeGreaterThanOrEqual(2)
    const body = await page.locator("body").innerText()
    expect(body).toContain("Hello AI")
    expect(body).toContain("Hi! How can I help?")

    // SSE 重连 / SDK 空 body fallback 在 mock 环境是常态错误,不算 fatal
    const fatalErrors = errors.filter(
      (e) =>
        !e.includes("event stream") &&
        !e.includes("ERR_CONNECTION_REFUSED") &&
        !e.includes("FETCH-FALSY-REJECTION") &&
        !e.includes("skipToken") &&
        !e.includes("Failed to load resource"),
    )
    expect(fatalErrors.length).toBe(0)
  })

  test("C2 — session appears in sidebar after creation", async ({ page }) => {
    await installServerMock(page)
    await bootstrapMock(page, {
      projects: [
        {
          id: "e2e-mock-project",
          worktree: DIRECTORY,
          vcs: undefined,
          time: { created: Date.now() },
        },
      ],
    })
    const chatHandle = await mockChatSSE(page)

    await page.goto("/")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(3000)

    await enterWorkspace(page)

    const session = createMockSession({
      sessionID: chatHandle.sessionID,
      directory: DIRECTORY,
      title: "Chat Loop Test",
    })

    await chatHandle.pushEvents([
      {
        // 必须带 directory — 否则 global-sdk 路由到 "global" channel,per-project sync 不会收到
        directory: DIRECTORY,
        payload: {
          id: "evt_c2_session_created",
          type: "session.created",
          properties: { info: session },
        },
      },
    ])

    // data-session-id 在 sidebar + recents panel 两处都 render,用 first() 避开 strict mode
    const sessionInSidebar = page.locator(`[data-session-id="${chatHandle.sessionID}"]`).first()
    await expect(sessionInSidebar).toBeVisible({ timeout: 15_000 })
  })

  test("C3 — loading indicator shows during AI processing", async ({ page }) => {
    await installServerMock(page)
    await bootstrapMock(page, {
      projects: [
        {
          id: "e2e-mock-project",
          worktree: DIRECTORY,
          vcs: undefined,
          time: { created: Date.now() },
        },
      ],
    })
    const chatHandle = await mockChatSSE(page)

    await page.goto("/")
    await page.waitForLoadState("domcontentloaded")
    await page.waitForTimeout(3000)

    await enterWorkspace(page)

    await submitPrompt(page, "Tell me something")
    await page.waitForTimeout(500)

    await waitForUserMessage(page, "Tell me something")

    const sessionID = chatHandle.sessionID
    await chatHandle.pushEvents([
      {
        directory: DIRECTORY,
        payload: {
          id: "evt_c3_status_busy",
          type: "session.status",
          properties: { sessionID, status: { type: "busy" } },
        },
      },
      {
        payload: {
          id: "evt_c3_session_created",
          type: "session.created",
          properties: {
            info: createMockSession({ sessionID, directory: DIRECTORY }),
          },
        },
      },
    ])
    const progress = page.locator('[data-component="session-progress"]')
    await expect(progress).toBeVisible({ timeout: 5_000 })

    const assistantMsgID = "msg_assistant_c3"
    const partID = "part_text_c3"
    await chatHandle.pushEvents([
      {
        directory: DIRECTORY,
        payload: {
          id: "evt_c3_user_msg",
          type: "message.updated",
          properties: {
            info: createMockUserMessage(sessionID, "msg_user_c3", "code"),
          },
        },
      },
      {
        directory: DIRECTORY,
        payload: {
          id: "evt_c3_asst_msg",
          type: "message.updated",
          properties: {
            info: createMockAssistantMessage(sessionID, assistantMsgID, "mock-provider", "mock-model", "msg_user_c3"),
          },
        },
      },
      {
        directory: DIRECTORY,
        payload: {
          id: "evt_c3_text_part",
          type: "message.part.updated",
          properties: {
            part: createMockTextPart(sessionID, assistantMsgID, partID, "Here's something interesting."),
          },
        },
      },
      {
        directory: DIRECTORY,
        payload: {
          id: "evt_c3_status_idle",
          type: "session.status",
          properties: { sessionID, status: { type: "idle" } },
        },
      },
    ])
    await waitForAssistantResponse(page, "Here's something interesting.")
    // progress 是否在 idle 后立刻隐藏行为不稳定(取决于 hiding 动画),
    // 这里只确认 assistant 文本到达 + busy 阶段曾经显示过 progress;hiding 行为留给 unit 测覆盖
  })
})
