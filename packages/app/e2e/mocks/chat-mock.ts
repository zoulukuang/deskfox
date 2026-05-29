import type { Page } from "@playwright/test"
import type { Agent, Message, Part, Provider, Session } from "@opencode-ai/sdk/v2/client"

const SERVER_PORT = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
const SERVER_PATTERN = `**:${SERVER_PORT}/**`

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const evtCounter = (() => {
  let n = 0
  return () => `evt_mock_${++n}`
})()

export interface ChatMockHandle {
  sessionID: string
  sessionDirectory: string
  pushEvents(events: GlobalEvent[]): void
}

export interface GlobalEvent {
  directory?: string
  payload: {
    id: string
    type: string
    properties: Record<string, unknown>
  }
}

interface ChatSessionOptions {
  sessionID?: string
  directory?: string
  title?: string
  providerID?: string
  modelID?: string
}

export function createMockSession(opts: ChatSessionOptions = {}): Session {
  return {
    id: opts.sessionID ?? "ses_clooptest001",
    slug: "chat-loop-test",
    projectID: "e2e-mock-project",
    directory: opts.directory ?? "/mock/workspace",
    title: opts.title ?? "Chat Loop Test",
    version: "1",
    time: { created: Date.now(), updated: Date.now() },
  }
}

export function createMockUserMessage(sessionID: string, messageID: string, agent: string): Message {
  return {
    id: messageID,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent,
  }
}

export function createMockAssistantMessage(
  sessionID: string,
  messageID: string,
  providerID: string,
  modelID: string,
): Message {
  return {
    id: messageID,
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
    model: { providerID, modelID },
  }
}

export function createMockTextPart(
  sessionID: string,
  messageID: string,
  partID: string,
  text: string,
): Part {
  return {
    id: partID,
    sessionID,
    messageID,
    type: "text",
    text,
    time: { start: Date.now() },
  }
}

export function buildChatFlowEvents(opts: {
  sessionID: string
  directory: string
  session: Session
  userMessageID: string
  userMessage: Message
  assistantMessageID: string
  assistantMessage: Message
  assistantParts: Part[]
}): GlobalEvent[] {
  return [
    {
      payload: { id: evtCounter(), type: "session.created", properties: { info: opts.session } },
    },
    {
      directory: opts.directory,
      payload: {
        id: evtCounter(),
        type: "session.status",
        properties: { sessionID: opts.sessionID, status: { type: "busy" } },
      },
    },
    {
      directory: opts.directory,
      payload: {
        id: evtCounter(),
        type: "message.updated",
        properties: { info: opts.userMessage },
      },
    },
    {
      directory: opts.directory,
      payload: {
        id: evtCounter(),
        type: "message.updated",
        properties: { info: opts.assistantMessage },
      },
    },
    ...opts.assistantParts.map((part) => ({
      directory: opts.directory,
      payload: {
        id: evtCounter(),
        type: "message.part.updated",
        properties: { part },
      },
    })),
    {
      directory: opts.directory,
      payload: {
        id: evtCounter(),
        type: "session.status",
        properties: { sessionID: opts.sessionID, status: { type: "idle" } },
      },
    },
  ]
}

function formatSSE(event: GlobalEvent): string {
  return `event: message\ndata: ${JSON.stringify(event)}\n\n`
}

const MOCK_PROVIDER: Provider = {
  id: "mock-provider",
  name: "Mock Provider",
  source: "config",
  env: [],
  options: {},
  models: {
    "mock-model": {
      id: "mock-model",
      name: "Mock Model",
      provider: { id: "mock-provider", name: "Mock Provider" },
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 4096 },
      family: "mock",
      release_date: "2026-01-01",
      attachment: { image: false, audio: false, video: false, pdf: false },
      temperature: true,
      reasoning: false,
      status: "active",
    },
  },
}

const MOCK_AGENTS: Agent[] = [
  {
    name: "code",
    description: "General coding agent",
    mode: "primary",
    prompt: "You are a helpful coding assistant.",
    temperature: 0,
    color: "#8B5CF6",
  },
] as unknown as Agent[]

export async function mockChatSSE(page: Page): Promise<ChatMockHandle> {
  const queue: GlobalEvent[] = []

  const sessionID = "ses_clooptest001"
  const directory = "/mock/workspace"
  const session = createMockSession({ sessionID, directory })

  async function* sseGenerator() {
    try {
      yield formatSSE({ payload: { id: evtCounter(), type: "server.connected", properties: {} } })
      await wait(100)

      while (true) {
        if (queue.length > 0) {
          const event = queue.shift()!
          yield formatSSE(event)
          continue
        }
        await wait(3000)
        yield formatSSE({ payload: { id: evtCounter(), type: "server.heartbeat", properties: {} } })
      }
    } catch {
      // connection closed by browser — normal during test teardown
    }
  }

  await page.route("**/global/event", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
      body: sseGenerator(),
    })
  })

  await page.route("**/session", async (route) => {
    const method = route.request().method()
    if (method === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(session),
      })
    }
    if (method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([session]),
      })
    }
    return route.fallback()
  })

  await page.route("**/prompt_async", async (route) => {
    await route.fulfill({ status: 204 })
  })

  await page.route("**/session/status", async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    })
  })

  await page.route("**/app/agents", async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_AGENTS),
    })
  })

  await page.route("**/provider", async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        all: [MOCK_PROVIDER],
        connected: [MOCK_PROVIDER.id],
        default: { [MOCK_PROVIDER.id]: MOCK_PROVIDER },
      }),
    })
  })

  await page.route(/\/session\/ses_\w+\/message(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    })
  })

  return {
    sessionID,
    sessionDirectory: directory,
    pushEvents(events: GlobalEvent[]) {
      queue.push(...events)
    },
  }
}

export function slugForDir(dir: string): string {
  return Buffer.from(dir, "utf-8").toString("base64").replaceAll(/[^a-zA-Z0-9_-]/g, "")
}
