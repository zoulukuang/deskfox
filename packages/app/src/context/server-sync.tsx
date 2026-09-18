import type {
  Config,
  OpencodeClient,
  Path,
  Project,
  ProviderAuthResponse,
  SessionStatus,
} from "@opencode-ai/sdk/v2/client"
import { showToast } from "@/utils/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { type Accessor, batch, createMemo, getOwner, onCleanup, onMount, untrack } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { InitError } from "../pages/error"
import { ServerSDK } from "./server-sdk"
import {
  bootstrapDirectory,
  bootstrapGlobal,
  clearProviderRev,
  loadAgentsQuery,
  loadCommands,
  loadGlobalConfigQuery,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
  loadReferencesQuery,
} from "./global-sync/bootstrap"
import { createChildStoreManager } from "./global-sync/child-store"
import { applyDirectoryEvent, applyGlobalEvent } from "./global-sync/event-reducer"
import { estimateRootSessionTotal, loadRootSessions, loadRootSessionsV1 } from "./global-sync/session-load"
import { trimSessions } from "./global-sync/session-trim"
import type { ProjectMeta } from "./global-sync/types"
import { SESSION_RECENT_LIMIT } from "./global-sync/types"
// FORK: 后端不可达守卫(coldstart-toast-race)[feat: electron-replatform]
import { formatServerError, isBackendUnreachableError, isUnservableDirError } from "@/utils/server-errors"
import { queryOptions, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/solid-query"
import type { SolidQueryOptions } from "@tanstack/solid-query"
import { createRefreshQueue } from "./global-sync/queue"
import { directoryKey } from "./global-sync/utils"
import { PathKey } from "@/utils/path-key"
import { createDirSyncContext } from "./directory-sync"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import { createRefCountMap } from "@/utils/refcount"
import { useGlobal } from "./global"
import { ServerConnection, useServer } from "./server"
import { retry } from "@opencode-ai/core/util/retry"
import type { ServerScope } from "@/utils/server-scope"
import { collectMissingBusySessions, collectStaleBusySessions } from "./global-sync/stale-busy"
import { createHomeSessionIndexCache } from "./global-sync/home-session-index"
import { persisted } from "@/utils/persist"
import type { ServerApi } from "@/utils/server"
import type {
  McpListInput,
  McpListOutput,
  McpResource,
  McpResourceCatalogInput,
  McpResourceCatalogOutput,
  McpServer,
  SessionActiveOutput,
} from "@opencode-ai/client/promise"
import { toggleMcp } from "./global-sync/mcp"
import { createServerSession, type ServerSession } from "./server-session"

// FORK: REQ-052 — 抽出纯函数供两处 predicate 复用,避免重复 lambda 2026-06-18
export function isProvidersQueryKey(key: readonly unknown[], scope: ServerScope): boolean {
  return key[0] === scope && key[2] === "providers"
}

type GlobalStore = {
  ready: boolean
  error?: InitError
  path: Path
  project: Project[]
  provider: NormalizedProviderListResponse
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

type McpListApi = {
  readonly list: (input?: McpListInput) => Promise<McpListOutput>
}

type McpResourceApi = {
  readonly resource: {
    readonly catalog: (input?: McpResourceCatalogInput) => Promise<McpResourceCatalogOutput>
  }
}

type ApiQueryOptions<T, K extends readonly unknown[]> = SolidQueryOptions<T, Error, T, K> & {
  initialData?: undefined
  queryKey: K
}

type SessionActiveApi = {
  readonly active: () => Promise<SessionActiveOutput>
}

export const loadMcpQuery = (
  scope: ServerScope,
  directory: string,
  api: McpListApi,
  legacy?: OpencodeClient,
  protocol?: Promise<"v1" | "v2">,
): ApiQueryOptions<Record<string, McpServer["status"]>, readonly [ServerScope, string, "mcp"]> =>
  queryOptions<
    Record<string, McpServer["status"]>,
    Error,
    Record<string, McpServer["status"]>,
    readonly [ServerScope, string, "mcp"]
  >({
    queryKey: [scope, directory, "mcp"] as const,
    queryFn: async () => {
      if ((await protocol) === "v1" && legacy) return (await legacy.mcp.status()).data ?? {}
      return api
        .list({ location: { directory } })
        .then((result) => Object.fromEntries(result.data.map((server) => [server.name, server.status])))
    },
  })

export const loadMcpResourcesQuery = (
  scope: ServerScope,
  directory: string,
  api: McpResourceApi,
  legacy?: OpencodeClient,
  protocol?: Promise<"v1" | "v2">,
): ApiQueryOptions<Record<string, McpResource>, readonly [ServerScope, string, "mcpResources"]> =>
  queryOptions<
    Record<string, McpResource>,
    Error,
    Record<string, McpResource>,
    readonly [ServerScope, string, "mcpResources"]
  >({
    queryKey: [scope, directory, "mcpResources"] as const,
    queryFn: async () => {
      if ((await protocol) === "v1" && legacy) {
        return Object.fromEntries(
          Object.entries((await legacy.experimental.resource.list()).data ?? {}).map(([key, resource]) => [
            key,
            { ...resource, server: resource.client },
          ]),
        )
      }
      return api.resource
        .catalog({ location: { directory } })
        .then((result) =>
          Object.fromEntries(result.data.resources.map((resource) => [`${resource.server}:${resource.uri}`, resource])),
        )
    },
    placeholderData: {},
  })

export const loadLspQuery = (scope: ServerScope, directory: string, sdk: OpencodeClient) =>
  queryOptions({
    queryKey: [scope, directory, "lsp"] as const,
    queryFn: () => sdk.lsp.status().then((r) => r.data ?? []),
  })

export const loadActiveSessionsQuery = (
  scope: ServerScope,
  api: SessionActiveApi,
): ApiQueryOptions<SessionActiveOutput, readonly [ServerScope, "activeSessions"]> =>
  queryOptions<SessionActiveOutput, Error, SessionActiveOutput, readonly [ServerScope, "activeSessions"]>({
    queryKey: [scope, "activeSessions"] as const,
    queryFn: () => api.active(),
    enabled: true,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

export function seedActiveSessionStatuses(
  session: Pick<ServerSession, "data" | "set">,
  active: SessionActiveOutput | Record<string, SessionStatus>,
) {
  for (const sessionID of Object.keys(active)) {
    if (session.data.session_status[sessionID] !== undefined) continue
    const status = active[sessionID]
    session.set("session_status", sessionID, status?.type === "running" ? { type: "busy" } : status)
  }
}

function makeQueryOptionsApi(
  scope: ServerScope,
  serverSDK: () => OpencodeClient,
  serverAPI: ServerApi,
  sdkFor: (dir: PathKey) => OpencodeClient,
  protocol: Promise<"v1" | "v2">,
) {
  return {
    globalConfig: () => loadGlobalConfigQuery(scope, serverSDK(), protocol),
    projects: () => loadProjectsQuery(scope, serverAPI.project),
    providers: (directory: PathKey | null) =>
      loadProvidersQuery(scope, directory, serverAPI, directory ? sdkFor(directory) : serverSDK(), protocol),
    path: (directory: PathKey | null) =>
      loadPathQuery(scope, directory, directory ? sdkFor(directory) : serverSDK(), protocol),
    agents: (directory: PathKey) => loadAgentsQuery(scope, directory, serverAPI.agent, sdkFor(directory), protocol),
    references: (directory: PathKey) =>
      loadReferencesQuery(scope, directory, serverAPI.reference, sdkFor(directory), protocol),
    mcp: (directory: PathKey) => loadMcpQuery(scope, directory, serverAPI.mcp, sdkFor(directory), protocol),
    mcpResources: (directory: PathKey) =>
      loadMcpResourcesQuery(scope, directory, serverAPI.mcp, sdkFor(directory), protocol),
    lsp: (directory: PathKey) => loadLspQuery(scope, directory, sdkFor(directory)),
    sessions: (directory: PathKey) => ({ queryKey: [scope, directory, "loadSessions"] as const }),
  }
}
export type QueryOptionsApi = ReturnType<typeof makeQueryOptionsApi>

export function createServerSyncContextInner(serverSDK: ServerSDK) {
  const language = useLanguage()
  const owner = getOwner()
  if (!owner) throw new Error("ServerSync must be created within owner")

  const sdkCache = new Map<string, OpencodeClient>()
  const booting = new Map<string, Promise<void>>()
  const sessionLoads = new Map<string, Promise<void>>()
  const sessionMeta = new Map<string, { limit: number }>()

  const sdkFor = (directory: string) => {
    const key = directoryKey(directory)
    const cached = sdkCache.get(key)
    if (cached) return cached
    const sdk = serverSDK.createClient({
      directory,
      throwOnError: true,
    })
    sdkCache.set(key, sdk)
    return sdk
  }

  const session = createServerSession(serverSDK.client, serverSDK.api.session, serverSDK.api.message, {
    protocol: serverSDK.protocol,
  })
  const queryOptionsApi = makeQueryOptionsApi(
    serverSDK.scope,
    () => serverSDK.client,
    serverSDK.api,
    sdkFor,
    serverSDK.protocol,
  )

  const [configQuery, providerQuery, pathQuery] = useQueries(() => ({
    queries: [queryOptionsApi.globalConfig(), queryOptionsApi.providers(null), queryOptionsApi.path(null)],
  }))
  const activeSessionsQuery = useQuery(() =>
    loadActiveSessionsQuery(serverSDK.scope, {
      active: async () => {
        if ((await serverSDK.protocol) === "v1") {
          const statuses = (await serverSDK.client.session.status()).data ?? {}
          seedActiveSessionStatuses(session, statuses)
          for (const sessionID of Object.keys(statuses)) {
            void session.resolve(sessionID).catch(() => undefined)
          }
          return Object.fromEntries(
            Object.entries(statuses).flatMap(([sessionID, status]) =>
              status.type === "idle" ? [] : [[sessionID, { type: "running" as const }]],
            ),
          )
        }
        const active = await serverSDK.api.session.active()
        seedActiveSessionStatuses(session, active)
        for (const sessionID of Object.keys(active)) {
          void session.resolve(sessionID).catch(() => undefined)
        }
        return active
      },
    }),
  )

  const [globalStore, setGlobalStore] = createStore<GlobalStore>({
    get ready() {
      return !bootstrap.isPending
    },
    project: [],
    provider_auth: {},
    get path() {
      const EMPTY = { state: "", config: "", worktree: "", directory: "", home: "" }
      if (pathQuery.isLoading) return EMPTY
      return pathQuery.data ?? EMPTY
    },
    get provider() {
      const EMPTY = { all: new Map(), connected: [], default: {} }
      if (providerQuery.isLoading) return EMPTY
      return providerQuery.data ?? EMPTY
    },
    get config() {
      if (configQuery.isLoading) return {}
      return configQuery.data ?? {}
    },
    get reload() {
      return updateConfigMutation.isPending ? "pending" : undefined
    },
  })

  // FORK-BEGIN: REQ-100 ②③ 后端权威全量忙闲对账 [feat: release-closeout-2026-09] 2026-09-17
  //
  // 2026-08-18 真机:后端 respawn 后前端确实重连并重跑了 6 个目录的 bootstrap,但出事的那个目录
  // **恰好不在这 6 个里** —— 它被 child store 的 eviction 挤掉了,而重连对账的循环有一道
  // `if (!children.active(directory)) continue`(见下方 server.connected 分支),于是被 evict 的
  // 目录永远拿不到对账,它名下会话的残留 busy 永不清除。净效果:卡死 ≥38 分钟。
  //
  // 修法不是"把那道闸删掉再按目录遍历一遍" —— 按目录切本身就是错的切法:忙闲是**会话**维度的,
  // 后端 SessionStatus 本来就有一张全局表(packages/opencode/src/session/status.ts),且它
  // **只存非 idle 项**(set 到 idle 会 delete),所以"不在表里 = idle"是后端的确定语义。
  // 于是这里改成:直接拿那张全局表,对本地做**权威覆盖**,完全不按目录切。
  //
  // 与既有 seedActiveSessionStatuses 的区别(那个不够用,这是第二层根因):
  //   seed 只填**本地缺失**的条目(`if (... !== undefined) continue`),对"本地 busy、后端 idle"
  //   的残留一个字都不改 —— 它是 seed,不是 reconcile。真正能清残留的只有按目录的 bootstrap
  //   全量替换,而那条正好被 active 闸挡住了。两处叠加才造成"代码在、也执行了,但恰好跳过出事那个"。
  //
  // 竞态护栏见 session.optimistic.pending():刚发出、后端还没登记的会话不参与清理。
  const reconcileSessionStatuses = async () => {
    // 🔴 2026-09-18 修正:status 表是**按目录**的(证据链见 stale-busy.ts 头部),
    //   必须按目录逐个查、且只在查过的目录内下结论。
    //
    // 目录集合取**并集**,两个方向各需要一半 —— 只取其一都会悄悄削弱另一个方向:
    //   ① 本地 busy 会话所属的目录 —— busy→idle 方向需要。从会话自身推导,所以
    //      **evict 过的目录照样覆盖得到**(那正是 REQ-100 的原始病灶),不依赖 child store。
    //   ② 当前已打开的目录(children.children,含根目录)—— idle→busy 方向需要。后端在忙、本地却不忙的
    //      会话,其所在目录本地**没有任何 busy**,只靠 ① 永远发现不了它。
    const directories = new Set<string>()
    for (const [sessionID, status] of Object.entries(session.data.session_status)) {
      if (status?.type !== "busy") continue
      const directory = session.get(sessionID)?.directory
      if (directory) directories.add(directory)
    }
    for (const directory of Object.keys(children.children)) directories.add(directory)
    if (directories.size === 0) return

    const remote: Record<string, boolean> = {}
    const covered = new Set<string>()

    // 🔴 2026-09-18 第三轮 code-review 修正:上一版把**协议分流删掉了**,无条件走 v1 的
    //   `sdkFor(directory).session.status()`。而 `sdkFor` → `serverSDK.createClient` 造的是 legacy v1 client,
    //   于是 v2 连接下每个目录都抛错、被下面的 `catch {}` 吞掉 → `covered` 恒空 →
    //   **正反两个方向全部空转,REQ-100 在 v2 上完全失效**,还每 60 秒对每个目录打一轮必失败的 HTTP。
    //   当时那句注释「与 bootstrap.ts:395 同一写法,两种协议通用」是错的 ——
    //   bootstrap.ts 紧挨着那行的上一行正是 `if ((await input.protocol) !== "v1") return`,
    //   即它本身就只在 v1 下执行。(本仓自带 sidecar 有 /global/health 判为 v1,所以自带包不受影响;
    //   受影响的是连远端 v2 服务端的场景。)
    if ((await serverSDK.protocol) === "v1") {
      // v1:`/session/status` 挂在 routes/instance/ 下,**按 directory 分桶**(见 stale-busy.ts 头部证据链),
      //     必须逐个目录查;目录由 sdkFor(directory) 建出的 client 自身携带,不另传参。
      await Promise.all(
        [...directories].map(async (directory) => {
          try {
            const statuses = (await sdkFor(directory).session.status()).data ?? {}
            for (const [sessionID, status] of Object.entries(statuses)) {
              if (status?.type !== "idle") remote[sessionID] = true
            }
            // 只有**查成功**的目录才进覆盖集:查失败时宁可不动,也不能误判成空闲
            covered.add(directory)
          } catch {
            // 单个目录查不动(后端半死 / 目录已不可服务)不影响其他目录,本轮跳过它
          }
        }),
      )
    } else {
      // v2:`GET /api/session/active` 的生成签名里**没有 directory / workspace 参数**
      //     (packages/client/src/generated/client.ts 的 `active: (requestOptions?) => ...`),
      //     按构造就是该服务器全局的 —— 一次调用即覆盖本轮所有目录,不存在 v1 那种分桶问题。
      //     这也正是改动前 v2 分支的原样语义,此处只是把它恢复回来。
      try {
        const active = await serverSDK.api.session.active()
        for (const sessionID of Object.keys(active)) remote[sessionID] = true
        for (const directory of directories) covered.add(directory)
      } catch {
        // 查不动就整轮跳过:covered 保持空,两个方向都不会下结论
      }
    }

    const args = {
      local: session.data.session_status,
      remote,
      pending: (sessionID: string) => session.optimistic.pending(sessionID),
      directoryOf: (sessionID: string) => session.get(sessionID)?.directory,
      coveredDirectories: covered,
    }
    const stale = collectStaleBusySessions(args)
    for (const sessionID of stale) session.set("session_status", sessionID, { type: "idle" })
    // FORK 2026-09-18:**双向**对账。只清不补的话,任何把本地错误写成 idle 的路径都永久无解 ——
    //   REQ-100 ① 停止键 4s 兜底就是这样一条(它的注释还写着「对账会把真实状态盖回来」,
    //   而当时对账根本没有这个方向)。后端那张表是权威,既然拿到了就两个方向都覆盖。
    //   反向不需要 coveredDirectories 守卫:remote 里的条目**本来就只来自查成功的目录**,
    //   是"后端明确说它在忙"的正面证据;而正向清理是从本地表反推"后端没说它忙",
    //   缺席既可能是真 idle、也可能是这个目录压根没查 —— 那才需要守卫。
    const missing = collectMissingBusySessions(args)
    for (const sessionID of missing) session.set("session_status", sessionID, { type: "busy" })
  }

  const reconcileSessionStatusesSafely = () => {
    void reconcileSessionStatuses().catch(() => {
      // 对账失败(后端仍不可达)不弹 toast:看门狗统管恢复 UX,这里只是错过一轮,下一轮再来。
    })
  }

  // ② 周期性对账 —— 不能只有「重连」才触发。事件流"活着但停止投递"时不会触发重连
  //    (心跳被无关事件不断 reset),那条路径下只有这个定时器救得回来。
  //    仅在窗口可见时跑:后台标签页没人看,白烧请求。
  const RECONCILE_INTERVAL_MS = 60_000
  const reconcileTimer = setInterval(() => {
    if (typeof document === "object" && document.visibilityState === "hidden") return
    reconcileSessionStatusesSafely()
  }, RECONCILE_INTERVAL_MS)
  onCleanup(() => clearInterval(reconcileTimer))
  // FORK-END

  const queryClient = useQueryClient()
  const homeSessions = createHomeSessionIndexCache(queryClient, ServerConnection.key(serverSDK.server))
  const refreshProviders = () =>
    queryClient.refetchQueries({
      predicate: (query) => query.queryKey[0] === serverSDK.scope && query.queryKey[2] === "providers",
    })

  let bootedAt = 0
  let eventFrame: number | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (eventFrame !== undefined) cancelAnimationFrame(eventFrame)
    if (eventTimer !== undefined) clearTimeout(eventTimer)
  })

  const setProjects = (next: Project[] | ((draft: Project[]) => Project[])) => {
    setGlobalStore("project", next)
  }

  const setBootStore = ((...input: unknown[]) => {
    if (input[0] === "project" && Array.isArray(input[1])) {
      setProjects(input[1] as Project[])
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const bootstrap = useQuery(() => ({
    queryKey: [serverSDK.scope, "bootstrap"],
    queryFn: async () => {
      await bootstrapGlobal({
        serverSDK: serverSDK.client,
        serverAPI: serverSDK.api,
        protocol: serverSDK.protocol,
        scope: serverSDK.scope,
        requestFailedTitle: language.t("common.requestFailed"),
        translate: language.t,
        formatMoreCount: (count) => language.t("common.moreCountSuffix", { count }),
        setGlobalStore: setBootStore,
        queryClient,
      })
      bootedAt = Date.now()
      return bootedAt
    },
  }))

  const set = ((...input: unknown[]) => {
    if (input[0] === "project" && (Array.isArray(input[1]) || typeof input[1] === "function")) {
      setProjects(input[1] as Project[] | ((draft: Project[]) => Project[]))
      return input[1]
    }
    return (setGlobalStore as (...args: unknown[]) => unknown)(...input)
  }) as typeof setGlobalStore

  const paused = () => untrack(() => globalStore.reload) !== undefined

  const queue = createRefreshQueue({
    paused,
    key: directoryKey,
    bootstrap: () => queryClient.fetchQuery({ queryKey: [serverSDK.scope, "bootstrap"] }),
    bootstrapInstance,
  })

  const children = createChildStoreManager({
    owner,
    scope: serverSDK.scope,
    persist: persisted,
    isBooting: (directory) => booting.has(directory),
    isLoadingSessions: (directory) => sessionLoads.has(directory),
    onBootstrap: (directory) => {
      void bootstrapInstance(directory)
    },
    onMcp: (directory, setStore) => {
      void loadCommands(directory, serverSDK.api.command, sdkFor(directory), serverSDK.protocol)
        .then((commands) => setStore("command", commands))
        .catch((err) => {
          // FORK: 切到缺失目录项目(/command 503 空 body)不弹冗余 toast [feat: project-continuity-v2026-8-4] 2026-07-05
          if (isUnservableDirError(err)) return
          showToast({
            variant: "error",
            title: language.t("toast.project.reloadFailed.title", { project: getFilename(directory) }),
            description: formatServerError(err, language.t),
          })
        })
    },
    onDispose: (directory) => {
      const key = directoryKey(directory)
      queue.clear(key)
      sessionMeta.delete(key)
      sdkCache.delete(key)
      clearProviderRev(serverSDK.scope, key)
    },
    translate: language.t,
    queryOptions: queryOptionsApi,
    global: {
      provider: globalStore.provider,
    },
  })

  async function loadSessions(directory: string, options?: { limit?: number }) {
    const key = directoryKey(directory)
    const pending = sessionLoads.get(key)
    if (pending) {
      await pending
      return loadSessions(directory, options)
    }

    children.pin(key)
    const [store, setStore] = children.child(directory, { bootstrap: false })
    const meta = sessionMeta.get(key)
    const retainedLimit = Math.max(store.limit, options?.limit ?? 0, meta?.limit ?? 0)
    if (meta && meta.limit >= retainedLimit) {
      const next = trimSessions(store.session, {
        limit: retainedLimit,
        permission: session.data.permission,
      })
      if (next.length !== store.session.length) {
        setStore("session", reconcile(next, { key: "id" }))
      }
      children.unpin(key)
      return
    }

    const limit = Math.max(retainedLimit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
    const promise = queryClient
      .fetchQuery({
        ...queryOptionsApi.sessions(key),
        queryFn: () =>
          serverSDK.protocol
            .then((protocol) =>
              protocol === "v1"
                ? loadRootSessionsV1({ client: sdkFor(directory), directory, limit })
                : loadRootSessions({ api: serverSDK.api.session, directory, limit }),
            )
            .then((x) => {
              const nonArchived = (x.data ?? [])
                .filter((s) => !!s?.id)
                .filter((s) => !s.time?.archived)
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              const limit = Math.max(store.limit, options?.limit ?? 0, sessionMeta.get(key)?.limit ?? 0)
              const childSessions = store.session.filter((s) => !!s.parentID)
              const next = trimSessions([...nonArchived, ...childSessions], {
                limit,
                permission: session.data.permission,
              })
              batch(() => {
                next.forEach(session.remember)
                setStore(
                  "sessionTotal",
                  estimateRootSessionTotal({
                    count: nonArchived.length,
                    limit: x.limit,
                    limited: x.limited,
                  }),
                )
                setStore("session", reconcile(next, { key: "id" }))
              })
              sessionMeta.set(key, { limit })
            })
            .catch((err) => {
              console.error("Failed to load sessions", err)
              // FORK: 后端不可达(sidecar 假死/看门狗重启窗口)不弹 toast — 看门狗统管恢复 UX [feat: coldstart-toast-race]
              if (isBackendUnreachableError(err)) return
              const project = getFilename(directory)
              showToast({
                variant: "error",
                title: language.t("toast.session.listFailed.title", { project }),
                description: formatServerError(err, language.t),
              })
            })
            .then(() => null),
      })
      .then(() => {})

    sessionLoads.set(key, promise)
    void promise.finally(() => {
      sessionLoads.delete(key)
      children.unpin(key)
    })
    return promise
  }

  async function bootstrapInstance(directory: string) {
    const key = directoryKey(directory)
    if (!key) return
    const pending = booting.get(key)
    if (pending) return pending

    children.pin(key)
    const promise = Promise.resolve().then(async () => {
      const child = children.ensureChild(directory)
      const cache = children.vcsCache.get(key)
      if (!cache) return
      const sdk = sdkFor(directory)
      await bootstrapDirectory({
        directory,
        scope: serverSDK.scope,
        mcp: children.mcp(key),
        global: {
          config: globalStore.config,
          path: globalStore.path,
          project: globalStore.project,
          provider: globalStore.provider,
        },
        sdk,
        api: serverSDK.api,
        store: child[0],
        setStore: child[1],
        vcsCache: cache,
        loadSessions,
        translate: language.t,
        queryClient,
        session,
        protocol: serverSDK.protocol,
      })
    })

    booting.set(key, promise)
    void promise.finally(() => {
      booting.delete(key)
      children.unpin(key)
    })
    return promise
  }

  const indexSession = (info: Parameters<typeof session.remember>[0]) => {
    const key = directoryKey(info.directory)
    const existing = children.children[key]
    if (!existing) return
    applyDirectoryEvent({
      event: { type: "session.created", properties: { info } },
      directory: key,
      store: existing[0],
      setStore: existing[1],
      push: queue.push,
      retainedLimit: sessionMeta.get(key)?.limit,
      sessionContent: false,
      permission: session.data.permission,
      loadLsp() {},
    })
  }

  const unsub = serverSDK.event.listen((e) => {
    const directory = e.name
    const key = directoryKey(directory)
    const event = e.details
    const eventType: string = event.type
    // FORK: REQ-100 ⑤ —— 原为 `bootingRoot || Date.now() - bootedAt < 1500`,而 bootingRoot 全仓
    //   只有"声明为 false"和"在这里被读"两处,没有任何地方赋 true —— 是个恒假的死变量。
    //   2026-08-07 那次关闭把它当成自愈链语义的一部分来读,是误判的一环。直接删,不补赋值:
    //   补赋值等于凭空新造一条没人验证过的语义。 [feat: release-closeout-2026-09] 2026-09-17
    const recent = Date.now() - bootedAt < 1500

    if (event.current) session.applyV2(event.current)
    session.apply(event)
    if (event.type === "session.created" || event.type === "session.updated" || event.type === "session.deleted") {
      homeSessions.apply(event)
    }
    homeSessions.refresh(event.type)
    if (eventType === "integration.connection.updated") void refreshProviders()

    if (directory === "global") {
      if (eventType === "server.connected" && activeSessionsQuery.data === undefined && !activeSessionsQuery.isFetching)
        void activeSessionsQuery.refetch()
      applyGlobalEvent({
        event,
        project: globalStore.project,
        refresh: () => {
          if (recent) return
          bootstrap.refetch()
        },
        setGlobalProject: setProjects,
      })
      if (
        eventType === "config.updated" ||
        eventType === "catalog.updated" ||
        eventType === "agent.updated" ||
        eventType === "project.directories.updated"
      )
        bootstrap.refetch()
      if (eventType === "server.connected" || eventType === "global.disposed") {
        if (recent) return
        // FORK: REQ-100 ③ —— 按目录刷新照旧(它还负责 bootstrap 其他数据),但**忙闲不再靠它**:
        //   下面这行全局对账不按目录切,被 evict 掉的目录名下的残留 busy 也能被清。
        //   [feat: release-closeout-2026-09] 2026-09-17
        reconcileSessionStatusesSafely()
        for (const directory of Object.keys(children.children)) {
          if (!children.active(directory)) continue
          queue.push(directory)
        }
      }
      return
    }

    if (event.current?.type === "session.moved") {
      const info = session.get(event.current.data.sessionID)
      if (info) indexSession(info)
    }
    if (event.current?.type === "session.forked")
      void session
        .resolve(event.current.data.sessionID, { force: true })
        .then(indexSession)
        .catch(() => {})

    const existing = children.children[key]
    if (!existing) return
    children.mark(key)
    if (
      event.current?.type === "session.moved" ||
      // event.current?.type === "session.archived" ||
      event.current?.type === "session.forked" ||
      eventType === "command.updated" ||
      eventType === "config.updated" ||
      eventType === "agent.updated"
    )
      queue.push(key)
    if (eventType === "mcp.status.changed") void queryClient.invalidateQueries(queryOptionsApi.mcp(key))
    if (eventType === "mcp.resources.changed") void queryClient.invalidateQueries(queryOptionsApi.mcpResources(key))
    const [store, setStore] = existing
    applyDirectoryEvent({
      event,
      directory,
      store,
      setStore,
      push: (directory) => {
        if (children.active(directory)) queue.push(directory)
      },
      retainedLimit: sessionMeta.get(key)?.limit,
      sessionContent: false,
      permission: session.data.permission,
      vcsCache: children.vcsCache.get(key),
      loadLsp: () => {
        if (!children.active(key)) return
        void queryClient.fetchQuery(queryOptionsApi.lsp(key))
      },
      loadReferences: () => {
        if (!children.active(key)) return
        void queryClient.fetchQuery(queryOptionsApi.references(key))
      },
    })
  })

  onCleanup(unsub)
  onCleanup(() => {
    queue.dispose()
  })
  onCleanup(() => {
    for (const directory of Object.keys(children.children)) {
      children.disposeDirectory(directoryKey(directory))
    }
  })

  onMount(() => {
    if (typeof requestAnimationFrame === "function") {
      eventFrame = requestAnimationFrame(() => {
        eventFrame = undefined
        eventTimer = setTimeout(() => {
          eventTimer = undefined
          void serverSDK.event.start()
        }, 0)
      })
    } else {
      eventTimer = setTimeout(() => {
        eventTimer = undefined
        void serverSDK.event.start()
      }, 0)
    }
  })

  const projectApi = {
    loadSessions,
    meta(directory: string, patch: ProjectMeta) {
      children.projectMeta(directory, patch)
    },
    icon(directory: string, value: string | undefined) {
      children.projectIcon(directory, value)
    },
  }

  const updateConfigMutation = useMutation(() => ({
    mutationFn: (config: Config) => serverSDK.client.global.config.update({ config }),
    onSuccess: () => {
      bootstrap.refetch()
      // Invalidate all provider queries so newly configured custom providers
      // appear immediately in the available provider list across all directories.
      queryClient.invalidateQueries({ queryKey: [serverSDK.scope, null, "providers"] })
      queryClient.invalidateQueries({
        predicate: (query) => isProvidersQueryKey(query.queryKey, serverSDK.scope),
      })
    },
  }))


  return {
    data: globalStore,
    set,
    get ready() {
      return globalStore.ready
    },
    get error() {
      return globalStore.error
    },
    child: children.child,
    peek: children.peek,
    disableMcp: children.disableMcp,
    queryOptions: queryOptionsApi,
    refreshProviders,
    updateConfig: updateConfigMutation.mutateAsync,
    project: projectApi,
    session,
    homeSessions,
    mcp: {
      toggle: async (directory: string, name: string) => {
        const key = directoryKey(directory)
        const sdk = sdkFor(key)
        const status = children.child(key, { bootstrap: false })[0].mcp[name]?.status
        if (!status) return
        await toggleMcp({
          status,
          connect: async () => {
            if ((await serverSDK.protocol) === "v1") {
              await sdk.mcp.connect({ name })
              return
            }
            await serverSDK.api.mcp.connect({ server: name, location: { directory: key } })
          },
          disconnect: async () => {
            if ((await serverSDK.protocol) === "v1") {
              await sdk.mcp.disconnect({ name })
              return
            }
            await serverSDK.api.mcp.disconnect({ server: name, location: { directory: key } })
          },
          authenticate: async () => {
            await sdk.mcp.auth.authenticate({ name })
          },
          refresh: async () => {
            await queryClient.refetchQueries(queryOptionsApi.mcp(key))
            await queryClient.refetchQueries(queryOptionsApi.mcpResources(key))
          },
        })
      },
    },
  }
}

export function createServerSyncContext(serverSDK: ServerSDK) {
  const inner = createServerSyncContextInner(serverSDK)
  return Object.assign(inner, {
    ensureDirSyncContext: createRefCountMap(
      (dir) => createDirSyncContext(dir, inner, serverSDK),
      (dir) => inner.disableMcp(dir),
      directoryKey,
    ),
  })
}

export type ServerSync = ReturnType<typeof createServerSyncContext>

export const { use: useServerSync, provider: ServerSyncProvider } = createSimpleContext({
  name: "ServerSync",
  // Returns an accessor so the resolved server can change reactively without
  // re-instantiating the subtree (mirrors useServerSDK).
  init: (props: { server?: Accessor<ServerConnection.Any | undefined> }) => {
    const global = useGlobal()
    const language = useLanguage()
    const server = useServer()

    return createMemo<ServerSync>(() => {
      const conn = props.server?.() ?? server.current
      if (!conn) throw new Error(language.t("error.serverSDK.noServerAvailable"))
      return global.ensureServerCtx(conn).sync
    })
  },
})

export function useQueryOptions() {
  const sync = useServerSync()
  return createMemo(() => sync().queryOptions)
}
