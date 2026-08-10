import type { Page, Route } from "@playwright/test"

const emptyList = new Set([
  "/skill",
  "/command",
  "/lsp",
  "/formatter",
  "/permission",
  "/question",
  "/vcs/status",
  "/vcs/diff",
  // FORK: REQ-095 — 面板输入关键词会打文件搜索端点,默认回 {} 会让 file.tsx `.map` 崩全屏
  //   ErrorBoundary;显式回空数组 [feat: session-content-search]
  "/find",
  "/find/file",
  "/find/symbol",
])
const emptyObject = new Set(["/global/config", "/config", "/provider/auth", "/mcp", "/session/status"])

export interface MockServerConfig {
  provider: unknown
  directory: string
  project: unknown
  sessions: ({ id: string } & Record<string, unknown>)[]
  pageMessages: (sessionId: string, limit: number, before?: string) => { items: unknown[]; cursor?: string }
  messageDelay?: number
  onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
  events?: () => unknown[]
  // FORK: 可选 —— mock `/file?path=` 列目录(给文件树类 spec 用,如 REQ-062 选中态)。
  //   返回该目录下的条目数组;不提供则 /file 返回 []。2026-06-18
  files?: (path: string) => unknown[]
  // FORK: REQ-095 可选 —— mock `/session/search` 会话内容搜索;不提供则返回 { hits: [] }。
  //   [feat: session-content-search]
  search?: (params: { query: string; scope: string }) => unknown
  eventRetry?: number
}

export async function mockOpenCodeServer(page: Page, config: MockServerConfig) {
  const staticRoutes: Record<string, unknown> = {
    "/provider": config.provider,
    "/path": {
      state: config.directory,
      config: config.directory,
      worktree: config.directory,
      directory: config.directory,
      home: "C:/OpenCode",
    },
    "/project": [config.project],
    "/project/current": config.project,
    "/agent": [{ name: "build", mode: "primary" }],
    "/vcs": { branch: "main", default_branch: "main" },
    "/session": config.sessions,
  }

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    const targetPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
    if (url.port !== targetPort) return route.fallback()

    const path = url.pathname
    if (path === "/global/event" || path === "/event") return sse(route, config.events?.(), config.eventRetry)
    if (path === "/global/health") return json(route, { healthy: true })
    if (emptyObject.has(path)) return json(route, {})
    if (emptyList.has(path)) return json(route, [])
    if (path in staticRoutes) return json(route, staticRoutes[path])

    if (path === "/file") return json(route, config.files?.(url.searchParams.get("path") ?? "") ?? [])

    // FORK: REQ-095 — 必须先于 /session/:id 匹配(与后端静态段优先一致)[feat: session-content-search]
    if (path === "/session/search") {
      const query = url.searchParams.get("query") ?? ""
      const scope = url.searchParams.get("scope") ?? "project"
      return json(route, config.search?.({ query, scope }) ?? { hits: [] })
    }

    const sessionMatch = path.match(/^\/session\/([^/]+)$/)
    if (sessionMatch) {
      const session = config.sessions.find((s) => s.id === sessionMatch[1])
      return json(route, session ?? {})
    }

    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(path)) return json(route, [])

    const messagesMatch = path.match(/^\/session\/([^/]+)\/message$/)
    if (messagesMatch) {
      const before = url.searchParams.get("before") ?? undefined
      config.onMessages?.({ sessionID: messagesMatch[1], before, phase: "start" })
      if (config.messageDelay) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const limit = Number(url.searchParams.get("limit") ?? 80)
      const pageData = config.pageMessages(messagesMatch[1], limit, before)
      config.onMessages?.({ sessionID: messagesMatch[1], before, phase: "end" })
      return json(route, pageData.items, pageData.cursor ? { "x-next-cursor": pageData.cursor } : undefined)
    }

    return json(route, {})
  })
}

function json(route: Route, body: unknown, headers?: Record<string, string>) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "x-next-cursor",
      ...headers,
    },
    body: JSON.stringify(body ?? null),
  })
}

function sse(route: Route, events?: unknown[], retry?: number) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `${retry === undefined ? "" : `retry: ${retry}\n\n`}${events?.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") || ": ok\n\n"}`,
  })
}
