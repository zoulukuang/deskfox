import { createSimpleContext } from "@opencode-ai/ui/context"
import { type Accessor, batch, createMemo } from "solid-js"
import { createStore, type SetStoreFunction, type Store } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { pathKey } from "@/utils/path-key"
import { ServerScope } from "@/utils/server-scope"
// FORK: win-anchor-hide-case-fold — 持久化匹配层统一走大小写不敏感目录比较(Windows 大小写不敏感;
//   POSIX 大小写敏感=零回归)。防持久化 worktree(历史/深链/手输,大小写不受控)与后端 realpath 规范化
//   路径差一位即匹配漏判 → relocate/setId/forget 静默失效。2026-07-07
import { sameDirectory } from "@/utils/same-directory"

// FORK: REQ-072 — 持久化 id,供改名后 stale 条目锚扫描 relocate(旧文件夹已消失、读不到锚,靠这个记住身份)
type StoredProject = { worktree: string; expanded: boolean; id?: string }
type StoredServer = string | ServerConnection.HttpBase | ServerConnection.Http
type ServerProjectState = {
  projects: Record<string, StoredProject[]>
  lastProject: Record<string, string>
  recentlyClosed: Record<string, string[]>
}
const HEALTH_POLL_INTERVAL_MS = 10_000
// The store retains more history than is displayed. Consumers filter recently closed entries
// against the live project list (dropping deleted projects) and then cap the visible count via
// RECENTLY_CLOSED_DISPLAY_LIMIT. Retaining extra history ensures entries that are temporarily
// filtered out do not evict still-visible ones from the persisted store.
const RECENTLY_CLOSED_HISTORY_LIMIT = 16
export const RECENTLY_CLOSED_DISPLAY_LIMIT = 5

export function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

export function serverName(conn?: ServerConnection.Any, ignoreDisplayName = false) {
  if (!conn) return ""
  if (conn.displayName && !ignoreDisplayName) return conn.displayName
  return conn.http.url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

function isLocalHost(url: string) {
  const host = url.replace(/^https?:\/\//, "").split(":")[0]
  if (host === "localhost" || host === "127.0.0.1") return "local"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function migrateCanonicalLocalServerState(value: unknown, canonicalLocalServer?: ServerConnection.Key) {
  if (!canonicalLocalServer || canonicalLocalServer === "local") return value
  if (!isRecord(value)) return value
  const projects = isRecord(value.projects) ? value.projects : undefined
  const lastProject = isRecord(value.lastProject) ? value.lastProject : undefined
  const previousProjects = projects?.[canonicalLocalServer]
  const previousLastProject = lastProject?.[canonicalLocalServer]
  if (!Array.isArray(previousProjects) && typeof previousLastProject !== "string") return value

  const next = { ...value }
  if (projects && Array.isArray(previousProjects)) {
    const local = Array.isArray(projects.local) ? projects.local : []
    const worktrees = new Set(
      local.flatMap((project) => (isRecord(project) && typeof project.worktree === "string" ? [project.worktree] : [])),
    )
    const migrated = previousProjects.filter((project) => {
      if (!isRecord(project) || typeof project.worktree !== "string") return true
      if (worktrees.has(project.worktree)) return false
      worktrees.add(project.worktree)
      return true
    })
    const nextProjects: Record<string, unknown> = { ...projects, local: [...local, ...migrated] }
    delete nextProjects[canonicalLocalServer]
    next.projects = nextProjects
  }
  if (lastProject && typeof previousLastProject === "string") {
    const nextLastProject = { ...lastProject }
    if (typeof nextLastProject.local !== "string") nextLastProject.local = previousLastProject
    delete nextLastProject[canonicalLocalServer]
    next.lastProject = nextLastProject
  }
  return next
}

export function createServerProjects<T extends ServerProjectState>(input: {
  scope: Accessor<ServerScope>
  store: Store<T>
  setStore: SetStoreFunction<T>
}) {
  const setStore = input.setStore as unknown as SetStoreFunction<ServerProjectState>
  const current = () => input.store.projects[input.scope()] ?? []
  const currentClosed = () => input.store.recentlyClosed?.[input.scope()] ?? []
  const remove = (directory: string) => {
    setStore(
      "projects",
      input.scope(),
      // FORK: win-anchor-hide-case-fold — Windows 盘符/大小写不受控,匹配用大小写不敏感比较
      current().filter((project) => !sameDirectory(project.worktree, directory)),
    )
  }
  return {
    list: current,
    recentlyClosed: currentClosed,
    remove,
    open(directory: string) {
      const scope = input.scope()
      const key = pathKey(directory)
      const closed = currentClosed()
      if (closed.some((worktree) => pathKey(worktree) === key)) {
        setStore(
          "recentlyClosed",
          scope,
          closed.filter((worktree) => pathKey(worktree) !== key),
        )
      }
      // FORK: win-anchor-hide-case-fold 大小写不敏感
      if (current().some((project) => sameDirectory(project.worktree, directory))) return
      setStore("projects", scope, [{ worktree: directory, expanded: true }, ...current()])
    },
    // User-initiated close: removes the project and records it in recently closed.
    // Internal, non-user removals (e.g. sandbox/worktree normalization) should use remove().
    close(directory: string) {
      remove(directory)
      const key = pathKey(directory)
      const closed = [directory, ...currentClosed().filter((worktree) => pathKey(worktree) !== key)].slice(
        0,
        RECENTLY_CLOSED_HISTORY_LIMIT,
      )
      setStore("recentlyClosed", input.scope(), closed)
    },
    expand(directory: string) {
      const index = current().findIndex((project) => sameDirectory(project.worktree, directory))
      if (index !== -1) setStore("projects", input.scope(), index, "expanded", true)
    },
    collapse(directory: string) {
      const index = current().findIndex((project) => sameDirectory(project.worktree, directory))
      if (index !== -1) setStore("projects", input.scope(), index, "expanded", false)
    },
    move(directory: string, toIndex: number) {
      const fromIndex = current().findIndex((project) => sameDirectory(project.worktree, directory))
      if (fromIndex === -1 || fromIndex === toIndex) return
      const next = [...current()]
      const [item] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, item)
      setStore("projects", input.scope(), next)
    },
    last() {
      return input.store.lastProject[input.scope()]
    },
    touch(directory: string) {
      setStore("lastProject", input.scope(), directory)
    },
    // FORK: REQ-068 — 默认项目目录已不存在(missing)时清掉它作为 lastProject,避免下次启动又自动加载死路径
    // → UI 落到项目选择器。仅当当前 scope 的 lastProject 正是该目录时才清,不误伤。2026-06-25 [feat: stale-path-hardening]
    forget(directory: string) {
      if (sameDirectory(input.store.lastProject[input.scope()] ?? "", directory)) {
        setStore("lastProject", input.scope(), undefined as unknown as string)
      }
    },
    // FORK: REQ-072 — 记住项目 id(打开成功后回写),供改名后 stale 条目锚扫描 relocate。仅在变化时写。
    setId(directory: string, id: string) {
      if (!id || id === "global") return
      const index = current().findIndex((project) => sameDirectory(project.worktree, directory))
      if (index === -1) return
      if (current()[index]?.id === id) return
      setStore("projects", input.scope(), index, "id", id)
    },
    // FORK: REQ-072 — 项目文件夹改名后,把 stale 旧路径条目就地改成新路径(保留 expanded/id);
    // 若该目录正是 lastProject 也一并改,避免下次启动又加载死路径。
    relocate(oldDirectory: string, newDirectory: string) {
      const scope = input.scope()
      const index = current().findIndex((project) => sameDirectory(project.worktree, oldDirectory))
      if (index !== -1) {
        // 按 index 判「新路径是否另有独立条目」,避免纯大小写改名(D:\Foo→D:\foo)时旧条目自己被当成
        // 「新路径已存在」而被误删(sameDirectory 折叠下 old 与 new 同键)。
        const newIndex = current().findIndex((project) => sameDirectory(project.worktree, newDirectory))
        if (newIndex !== -1 && newIndex !== index) {
          // 新路径已有独立条目(用户已 Open Folder 过)→ 删旧 stale 条目去重
          setStore("projects", scope, current().filter((_, i) => i !== index))
        } else {
          setStore("projects", scope, index, "worktree", newDirectory)
        }
      }
      if (sameDirectory(input.store.lastProject[scope] ?? "", oldDirectory)) {
        setStore("lastProject", scope, newDirectory)
      }
    },
  }
}

export function resolveServerList(input: {
  props?: Array<ServerConnection.Any>
  stored: StoredServer[]
}): Array<ServerConnection.Any> {
  const deduped = new Map<ServerConnection.Key, ServerConnection.Any>(
    input.props?.map((v) => [ServerConnection.key(v), v]) ?? [],
  )

  for (const value of input.stored) {
    const conn: ServerConnection.Http =
      typeof value === "string"
        ? {
            type: "http" as const,
            http: { url: value },
          }
        : "http" in value
          ? value
          : { type: "http", http: value }
    const key = ServerConnection.key(conn)

    const existing = deduped.get(key)
    if (existing)
      deduped.set(key, {
        ...existing,
        ...conn,
        http: { ...existing.http, ...conn.http },
      })
    else deduped.set(key, conn)
  }

  return [...deduped.values()]
}

export namespace ServerConnection {
  type Base = { displayName?: string; label?: string }

  export type HttpBase = {
    url: string
    username?: string
    password?: string
  }

  // Regular web connections
  export type Http = {
    type: "http"
    http: HttpBase
    authToken?: boolean
  } & Base

  export type Sidecar = {
    type: "sidecar"
    http: HttpBase
  } & (
    | // Regular desktop server
    { variant: "base" }
    // WSL server (windows only)
    | {
        variant: "wsl"
        distro: string
      }
  ) &
    Base

  // Remote server desktop can SSH into
  export type Ssh = {
    type: "ssh"
    host: string
    // SSH client exposes an HTTP server for the app to use as a proxy
    http: HttpBase
  } & Base

  export type Any =
    | Http
    // All these are desktop-only
    | (Sidecar | Ssh)

  export const key = (conn: Any): Key => {
    switch (conn.type) {
      case "http":
        return Key.make(conn.http.url)
      case "sidecar": {
        if (conn.variant === "wsl") return Key.make(`wsl:${conn.distro}`)
        return Key.make("sidecar")
      }
      case "ssh":
        return Key.make(`ssh:${conn.host}`)
    }
  }

  export type Key = string & { _brand: "Key" }
  export const Key = { make: (v: string) => v as Key }

  export const builtin = (conn: Any) => conn.type === "sidecar" && conn.variant === "base"
  export const local = (conn?: Any) =>
    !!conn && (builtin(conn) || (conn.type === "http" && isLocalHost(conn.http.url) === "local"))
}

export function nextServerAfterRemoval(
  servers: ServerConnection.Any[],
  removed: ServerConnection.Key,
  fallback: ServerConnection.Key,
) {
  const remaining = servers.filter((server) => ServerConnection.key(server) !== removed)
  const next = remaining.find((server) => ServerConnection.key(server) === fallback) ?? remaining[0]
  return next ? ServerConnection.key(next) : fallback
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  gate: true,
  init: (props: {
    defaultServer: ServerConnection.Key
    canonicalLocalServer?: ServerConnection.Key
    servers?: Array<ServerConnection.Any>
  }) => {
    const [store, setStore, _, ready] = persisted(
      {
        ...Persist.global("server", ["server.v3"]),
        migrate: (value) => migrateCanonicalLocalServerState(value, props.canonicalLocalServer),
      },
      createStore({
        list: [] as StoredServer[],
        projects: {} as Record<string, StoredProject[]>,
        lastProject: {} as Record<string, string>,
        recentlyClosed: {} as Record<string, string[]>,
      }),
    )

    const url = (x: StoredServer) => (typeof x === "string" ? x : "type" in x ? x.http.url : x.url)

    const allServers = createMemo((): Array<ServerConnection.Any> => {
      return resolveServerList({ stored: store.list, props: props.servers })
    })

    const [state, setState] = createStore({
      active: props.defaultServer,
    })

    function setActive(input: ServerConnection.Key) {
      if (state.active !== input) setState("active", input)
    }

    function add(input: ServerConnection.Http) {
      const url_ = normalizeServerUrl(input.http.url)
      if (!url_) return
      const conn: ServerConnection.Http = { ...input, authToken: undefined, http: { ...input.http, url: url_ } }
      return batch(() => {
        const existing = store.list.findIndex((x) => url(x) === url_)
        if (existing !== -1) {
          setStore("list", existing, conn)
        } else {
          setStore("list", store.list.length, conn)
        }
        setState("active", ServerConnection.key(conn))
        return conn
      })
    }

    function remove(key: ServerConnection.Key) {
      const next = nextServerAfterRemoval(allServers(), key, props.defaultServer)
      const list = store.list.filter((x) => url(x) !== key)
      batch(() => {
        setStore("list", list)
        if (state.active === key) setState("active", next)
      })
    }

    const isReady = Object.assign(
      createMemo(() => ready() && !!state.active),
      { promise: ready.promise },
    )

    const scope = (key = state.active) => ServerScope.fromServerKey(key, props.canonicalLocalServer)
    const projects = createServerProjects({ scope, store, setStore })
    const projectStores = new Map<ServerConnection.Key, ReturnType<typeof createServerProjects>>()
    const projectsForServer = (key: ServerConnection.Key) => {
      const existing = projectStores.get(key)
      if (existing) return existing
      const next = createServerProjects({ scope: () => scope(key), store, setStore })
      projectStores.set(key, next)
      return next
    }
    const current: Accessor<ServerConnection.Any | undefined> = createMemo(
      () => allServers().find((s) => ServerConnection.key(s) === state.active) ?? allServers()[0],
    )
    const isLocal = createMemo(() => ServerConnection.local(current()))

    return {
      ready: isReady,
      isLocal,
      get key() {
        return state.active
      },
      get name() {
        return serverName(current())
      },
      get list() {
        return allServers()
      },
      get current() {
        return current()
      },
      setActive,
      add,
      remove,
      scope,
      projects: {
        ...projects,
        forServer: projectsForServer,
      },
    }
  },
})
