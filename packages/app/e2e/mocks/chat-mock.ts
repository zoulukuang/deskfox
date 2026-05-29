// FORK: chat-loop e2e mock — Phase 1 mock mode 聊天链路
// [feat: e2e-chat-loop] 2026-05-29 接手 WIP
//
// 与 bootstrap-mock 的关系:bootstrap 让 UI 进 ready,chat-mock 在它之上接通"聊天发送 + SSE 推回"链路。
// 路由 glob `**/foo` 不匹配 `/foo?directory=xxx`(query 算 path 一部分),per-project endpoint 全带 `?directory=`,
// 因此 chat 涉及的 endpoint 一律用 RegExp `/\/foo(\?|$)/` 兜住带 query 和不带 query 两种形态。
//
// SSE 不能走 `route.fulfill({body: asyncGen})` —— Playwright body 类型只接 string|Buffer。
// 改用 `addInitScript` 在浏览器端 patch `window.fetch` 拦 `/global/event` 返回 ReadableStream,
// 测试侧通过 `page.evaluate` 调 `window.__deskfoxE2eSSE.push(events)` 往 stream 里 enqueue 帧。

import type { Page } from "@playwright/test"
import type { Agent, Message, Part, Provider, Session } from "@opencode-ai/sdk/v2/client"

const evtCounter = (() => {
  let n = 0
  return () => `evt_mock_${++n}`
})()

export interface ChatMockHandle {
  sessionID: string
  sessionDirectory: string
  pushEvents(events: GlobalEvent[]): Promise<void>
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
  parentID?: string,
): Message {
  // 完整 AssistantMessage shape — session-context-metrics 会无脑读 tokens.input/output/...,
  // SessionTurn 用 parentID 归组,二者缺一就 ErrorBoundary 全屏崩
  return {
    id: messageID,
    sessionID,
    role: "assistant",
    time: { created: Date.now() },
    providerID,
    modelID,
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    path: { cwd: "/mock/workspace", root: "/mock/workspace" },
    system: [],
    mode: "primary",
    ...(parentID ? { parentID } : {}),
  } as unknown as Message
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

// 浏览器端 SSE patch — `goto` 前注入,运行时 page.evaluate 推帧
async function installSSEPatch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Ctrl = ReadableStreamDefaultController<Uint8Array>
    const w = window as unknown as {
      __deskfoxE2eSSE?: { push(events: unknown[]): void; controllers: Ctrl[] }
      fetch: typeof fetch
    }
    if (w.__deskfoxE2eSSE) return // 避免重复 install

    const controllers: Ctrl[] = []
    const encoder = new TextEncoder()
    const format = (evt: unknown) =>
      encoder.encode(`event: message\ndata: ${JSON.stringify(evt)}\n\n`)

    w.__deskfoxE2eSSE = {
      controllers,
      push(events: unknown[]) {
        for (const evt of events) {
          const chunk = format(evt)
          for (const c of controllers) {
            try {
              c.enqueue(chunk)
            } catch {
              // 已 close/cancel 的 controller 吞掉
            }
          }
        }
      },
    }

    const origFetch = w.fetch.bind(window)
    w.fetch = async function patched(input, init) {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url
      if (url && url.includes("/global/event")) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controllers.push(controller)
            controller.enqueue(
              format({ payload: { id: "evt_init", type: "server.connected", properties: {} } }),
            )
          },
        })
        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        })
      }
      return origFetch(input as never, init)
    } as typeof fetch
  })
}

export async function mockChatSSE(page: Page): Promise<ChatMockHandle> {
  await installSSEPatch(page)

  const sessionID = "ses_clooptest001"
  const directory = "/mock/workspace"
  const session = createMockSession({ sessionID, directory })

  // /path 带 query 形态 — bootstrapMock 的 `**/path` glob 不匹配 `/path?directory=`,
  // sidebar 排序 root sessions 时读 `store.path.directory`,缺它会 `pathKey(undefined)` 崩
  await page.route(/\/path(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        home: "/mock/home",
        state: "/mock/state",
        config: "/mock/config",
        worktree: "/mock/workspace",
        directory: "/mock/workspace",
      }),
    })
  })

  // /project 带 query 形态 — 同上
  await page.route(/\/project(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "e2e-mock-project",
          worktree: "/mock/workspace",
          vcs: undefined,
          time: { created: Date.now() },
        },
      ]),
    })
  })

  // /session GET 列表 / POST 创建 — 带 ?directory= 也要兜
  await page.route(/\/session(\?|$)/, async (route) => {
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

  // /session/<id>/prompt_async — 真路径 /session/{id}/prompt_async?directory=...
  await page.route(/\/session\/[^/]+\/prompt_async(\?|$)/, async (route) => {
    await route.fulfill({ status: 204 })
  })

  // /session/status?directory=...
  await page.route(/\/session\/status(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    })
  })

  // /agent — 真实路径(不是 /app/agents),带 ?directory= 也要兜
  await page.route(/\/agent(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_AGENTS),
    })
  })

  // /provider — 全局 + per-project 都兜
  await page.route(/\/provider(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        all: [MOCK_PROVIDER],
        connected: [MOCK_PROVIDER.id],
        default: { [MOCK_PROVIDER.id]: "mock-model" }, // 注:value 是 modelID 字符串,不是 provider 对象
      }),
    })
  })

  // /session/<id>/message — 拉历史消息,empty 即可
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
    async pushEvents(events: GlobalEvent[]) {
      await page.evaluate((evts) => {
        const w = window as unknown as { __deskfoxE2eSSE?: { push(events: unknown[]): void } }
        w.__deskfoxE2eSSE?.push(evts)
      }, events)
    },
  }
}

export function slugForDir(dir: string): string {
  return Buffer.from(dir, "utf-8").toString("base64").replaceAll(/[^a-zA-Z0-9_-]/g, "")
}
