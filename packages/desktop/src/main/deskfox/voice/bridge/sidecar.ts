// [fork-only] voice-acp-bridge — DeskFox sidecar 的 HTTP 客户端 [feat: voice-acp-bridge] 2026-08-24
//
// 这是整条路线的支点:**语音派出的每一条 session 都由 DeskFox 自己的 sidecar 创建**,
// 于是它和用户手敲出来的 session 走同一个进程、同一个事件总线、同一个库 —— R3/R6 变成结构保证,
// 不再需要 voice-dispatch-minimal 那一整片补丁(跨进程强刷列表、DB 渠道分流、journal 归档…)。
//
// 刻意用裸 fetch 而不是 `@opencode-ai/sdk`:桥是 qwen spawn 的独立进程,依赖越少越不容易在
// 打包/运行时形态变化时炸;而且 fetch 可注入,单测不起真 server。
//
// 几条从 server 源码核对过的契约(`packages/opencode/src/server/routes/instance/httpapi/`):
//   · 路径全部根挂载,无 `/v1` 前缀;`?directory=` 决定落到哪个 instance,**必须传绝对路径**;
//   · `POST /session/:id/message` 是**同步阻塞**直到整轮跑完 —— 长任务会挂住 HTTP 连接,
//     所以我们一律走 `prompt_async`(立即 204)+ SSE 等 `session.idle`;
//   · **同一 session 并发 prompt 不会 409**:第二个请求会 join 第一个的 fiber,两条 user message
//     都写进去,却只有**一次** `session.idle`。按"一发一等"配对必然错配 ⇒ 调用侧自己串行化。

export interface SidecarSession {
  readonly id: string
  readonly title?: string
  readonly directory?: string
  readonly time?: { readonly updated?: number }
}

/** sidecar SSE 的一条事件(`GET /event` 的 data 字段)。 */
export interface SidecarEvent {
  readonly type: string
  readonly properties?: Record<string, unknown>
}

export interface SidecarClientOptions {
  readonly baseUrl: string
  readonly authorization: string
  readonly fetch?: typeof fetch
  readonly log?: (message: string) => void
}

export interface PromptPart {
  readonly type: "text"
  readonly text: string
}

export class SidecarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "SidecarError"
  }
}

export function createSidecarClient(options: SidecarClientOptions) {
  const doFetch = options.fetch ?? fetch
  const log = options.log ?? (() => {})
  const base = options.baseUrl.replace(/\/+$/, "")

  const url = (path: string, directory: string, extra?: Record<string, string>): string => {
    const u = new URL(`${base}${path}`)
    u.searchParams.set("directory", directory)
    for (const [k, v] of Object.entries(extra ?? {})) u.searchParams.set(k, v)
    return u.toString()
  }

  const headers = (extra?: Record<string, string>): Record<string, string> => ({
    Authorization: options.authorization,
    ...extra,
  })

  const call = async (path: string, directory: string, init: RequestInit & { query?: Record<string, string> }) => {
    const res = await doFetch(url(path, directory, init.query), {
      ...init,
      headers: headers({
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new SidecarError(`${init.method ?? "GET"} ${path} → ${res.status} ${body.slice(0, 300)}`, res.status)
    }
    return res
  }

  const json = async <T>(res: Response): Promise<T> => {
    const text = await res.text()
    if (!text.trim()) return {} as T
    return JSON.parse(text) as T
  }

  return {
    /** 建一条 session。**这一步就是「语音任务出现在 DeskFox 列表里」的全部魔法** —— 没有别的同步机制。 */
    async createSession(directory: string, input?: { title?: string }): Promise<SidecarSession> {
      const res = await call("/session", directory, {
        method: "POST",
        body: JSON.stringify(input?.title ? { title: input.title } : {}),
      })
      return await json<SidecarSession>(res)
    },

    /**
     * 异步发 prompt:立即 204 返回,执行过程走事件流。长任务绝不能用同步那条。
     *
     * `system` 是**追加**的 system prompt(不覆盖内置),coordinator 的路由引导走这里 ——
     * 比旧方案的全局 `config.instructions` 精确:只有这条 session 读得到,
     * 用户手敲的会话和第三层任务都不受影响。
     */
    async promptAsync(
      directory: string,
      sessionID: string,
      parts: readonly PromptPart[],
      options?: {
        system?: string
        model?: { providerID: string; modelID: string } | null
        /** 工具开关;`false` 会被 sidecar 翻成 permission deny(`prompt.ts:1068`) */
        tools?: Record<string, boolean>
      },
    ): Promise<void> {
      await call(`/session/${encodeURIComponent(sessionID)}/prompt_async`, directory, {
        method: "POST",
        body: JSON.stringify({
          parts,
          ...(options?.system ? { system: options.system } : {}),
          // 不传 model = 跟随 session 绑定的模型,第三层走的就是这条(R2/R3 同源)
          ...(options?.model ? { model: options.model } : {}),
          ...(options?.tools ? { tools: options.tools } : {}),
        }),
      })
    },

    /** 中止一条 session 的当前轮次。恒返回 true,即使本来就 idle。 */
    async abort(directory: string, sessionID: string): Promise<void> {
      await call(`/session/${encodeURIComponent(sessionID)}/abort`, directory, { method: "POST" })
    },

    async listSessions(directory: string, limit = 50): Promise<readonly SidecarSession[]> {
      const res = await call("/session", directory, { method: "GET", query: { limit: String(limit) } })
      const data = await json<SidecarSession[] | null>(res)
      return Array.isArray(data) ? data : []
    },

    /**
     * 动态注册 MCP server。⚠️ **只写内存、只对这个 directory 生效**
     * (`mcp/index.ts:641-646` 往 InstanceState 塞,不落配置文件)。
     * 对我们正好:桥进程/实例一没,注册就消失,不会给用户目录留下永久残留。
     */
    async addMcp(directory: string, name: string, config: unknown): Promise<void> {
      await call("/mcp", directory, { method: "POST", body: JSON.stringify({ name, config }) })
    },

    /**
     * 订阅某个 directory 的事件流。**事件按 directory 过滤**(`handlers/event.ts:36-39`),
     * 所以订阅用的 directory 必须与建 session 用的**字符串完全一致**。
     *
     * 返回一个 stop 函数。断流不抛错,交由调用方决定重连 —— 桥的策略见 bridge.ts。
     */
    subscribeEvents(
      directory: string,
      onEvent: (event: SidecarEvent) => void,
      onClose?: (reason: string) => void,
    ): () => void {
      const controller = new AbortController()
      void (async () => {
        try {
          const res = await doFetch(url("/event", directory), {
            headers: headers({ accept: "text/event-stream" }),
            signal: controller.signal,
          })
          if (!res.ok || !res.body) throw new Error(`事件流 ${res.status}`)
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ""
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            // SSE 记录以空行分隔;一条记录里我们只关心 `data:` 行
            let sep: number
            while ((sep = buf.indexOf("\n\n")) >= 0) {
              const record = buf.slice(0, sep)
              buf = buf.slice(sep + 2)
              for (const line of record.split("\n")) {
                if (!line.startsWith("data:")) continue
                const payload = line.slice(5).trim()
                if (!payload) continue
                try {
                  onEvent(JSON.parse(payload) as SidecarEvent)
                } catch {
                  log(`事件流里跳过一条非 JSON data:${payload.slice(0, 200)}`)
                }
              }
            }
          }
          onClose?.("事件流正常结束")
        } catch (e) {
          if (controller.signal.aborted) return
          onClose?.(String((e as { message?: string })?.message ?? e))
        }
      })()
      return () => controller.abort()
    },
  }
}

export type SidecarClient = ReturnType<typeof createSidecarClient>
