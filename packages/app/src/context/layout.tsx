import { createStore, produce } from "solid-js/store"
import { batch, createEffect, createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { useLocation } from "@solidjs/router"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useServerSync } from "./server-sync"
import { useServerSDK } from "./server-sdk"
import { ServerConnection, useServer } from "./server"
import { usePlatform } from "./platform"
import { Project } from "@opencode-ai/sdk/v2"
import { Persist, persisted, removePersisted } from "@/utils/persist"
// FORK: REQ-041/042 — 文件 tab 项目级 key + 会话级伪标签合成 [feat: iconbar-left-decouple] 2026-06-02
import { projectTabKey, synthTabs, type SessionPseudoTab } from "./session-key"
import { decode64 } from "@/utils/base64"
// FORK: REQ-042 #2 — 关项目时按项目 key 删其文件 tab [feat: file-tabs-project-level] 2026-06-02
import { base64Encode } from "@opencode-ai/core/util/encode"
import { same } from "@/utils/same"
import { createScrollPersistence, type SessionScroll } from "./layout-scroll"
import { createPathHelpers } from "./file/path"
import type { ProjectAvatarVariant } from "@opencode-ai/ui/v2/project-avatar-v2"
import { migrateLegacySessionStateKeys, ServerScope, SessionStateKey } from "@/utils/server-scope"
import { createSessionKeyReader, ensureSessionKey, pruneSessionKeys } from "./layout-helpers"
// FORK: project-avatar-save [feat: project-avatar-save]
import { resolveLocalIconOverride } from "./project-icon-override"

export { createSessionKeyReader, ensureSessionKey, pruneSessionKeys }

export type { ProjectAvatarVariant }

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const
const DEFAULT_SIDEBAR_WIDTH = 344
const DEFAULT_FILE_TREE_WIDTH = 200
const DEFAULT_SESSION_WIDTH = 600
const DEFAULT_TERMINAL_HEIGHT = 280
export type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number]

export function getAvatarColors(key?: string) {
  if (key && AVATAR_COLOR_KEYS.includes(key as AvatarColorKey)) {
    return {
      background: `var(--avatar-background-${key})`,
      foreground: `var(--avatar-text-${key})`,
    }
  }
  return {
    background: "var(--surface-info-base)",
    foreground: "var(--text-base)",
  }
}

export function getProjectAvatarVariant(key?: string): ProjectAvatarVariant {
  if (key === "orange") return "orange"
  if (key === "pink") return "pink"
  if (key === "cyan") return "cyan"
  if (key === "purple") return "purple"
  if (key === "mint") return "cyan"
  if (key === "lime") return "green"
  return "gray"
}

type SessionTabs = {
  active?: string
  all: string[]
}

type SessionView = {
  scroll: Record<string, SessionScroll>
  reviewOpen?: string[]
  pendingMessage?: string
  pendingMessageAt?: number
  todoCollapsed?: boolean
  // FORK: REQ-042 #3 — 会话级伪标签(审查/上下文 active + 上下文是否打开),从项目级文件 tab 拆出 [feat: file-tabs-project-level]
  tab?: SessionPseudoTab
}

type TabHandoff = {
  scope: ServerScope
  dir: string
  id: string
  at: number
}

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }

export type ReviewDiffStyle = "unified" | "split"

export type LayoutRoute =
  | { type: "home" }
  | { type: "draft"; draftID: string; server?: ServerConnection.Key }
  | { type: "dir-new-sesssion"; dir: string; dirBase64: string; server?: ServerConnection.Key }
  | { type: "session"; dir: string; dirBase64: string; sessionId: string; server?: ServerConnection.Key }

function nextSessionTabsForOpen(current: SessionTabs | undefined, tab: string): SessionTabs {
  const all = current?.all ?? []
  if (tab === "review") return { all: all.filter((x) => x !== "review"), active: tab }
  if (tab === "context") return { all: [tab, ...all.filter((x) => x !== tab)], active: tab }
  if (!all.includes(tab)) return { all: [...all, tab], active: tab }
  return { all, active: tab }
}

const sessionPath = (key: string) => {
  const dir = SessionStateKey.route(key).split("/")[0]
  if (!dir) return
  const root = decode64(dir)
  if (!root) return
  return createPathHelpers(() => root)
}

const normalizeSessionTab = (path: ReturnType<typeof createPathHelpers> | undefined, tab: string) => {
  if (!tab.startsWith("file://")) return tab
  if (!path) return tab
  return path.tab(tab)
}

const normalizeSessionTabList = (path: ReturnType<typeof createPathHelpers> | undefined, all: string[]) => {
  const seen = new Set<string>()
  return all.flatMap((tab) => {
    const value = normalizeSessionTab(path, tab)
    if (seen.has(value)) return []
    seen.add(value)
    return [value]
  })
}

const normalizeStoredSessionTabs = (key: string, tabs: SessionTabs) => {
  const path = sessionPath(key)
  return {
    all: normalizeSessionTabList(path, tabs.all),
    active: tabs.active ? normalizeSessionTab(path, tabs.active) : tabs.active,
  }
}

const currentRoute = (pathname: string, search: string): LayoutRoute => {
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length === 0) return { type: "home" }

  if (parts[0] === "new-session") {
    const draftID = new URLSearchParams(search).get("draftId")
    if (!draftID) return { type: "home" }
    return { type: "draft", draftID }
  }

  const dirBase64 = parts[0]
  const dir = decode64(dirBase64)
  if (!dir) return { type: "home" }

  if (parts[1] !== "session") return { type: "home" }

  const id = parts[2]
  if (id) return { type: "session", dir, dirBase64, sessionId: id }
  return { type: "dir-new-sesssion", dir, dirBase64 }
}

export const { use: useLayout, provider: LayoutProvider } = createSimpleContext({
  name: "Layout",
  gate: false,
  init: () => {
    const serverSdk = useServerSDK()
    const serverSync = useServerSync()
    const server = useServer()
    const platform = usePlatform()
    const location = useLocation()
    const route = createMemo(() => {
      const value = currentRoute(location.pathname, location.search)
      if (value.type === "home") return value
      return { ...value, server: server.key }
    })

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value)

    const migrate = (value: unknown) => {
      if (!isRecord(value)) return value

      const sidebar = value.sidebar
      const migratedSidebar = (() => {
        if (!isRecord(sidebar)) return sidebar
        if (typeof sidebar.workspaces !== "boolean") return sidebar
        return {
          ...sidebar,
          workspaces: {},
          workspacesDefault: sidebar.workspaces,
        }
      })()

      const review = value.review
      const fileTree = value.fileTree
      const migratedFileTree = (() => {
        if (!isRecord(fileTree)) return fileTree
        if (fileTree.tab === "changes" || fileTree.tab === "all") return fileTree

        const width = typeof fileTree.width === "number" ? fileTree.width : DEFAULT_FILE_TREE_WIDTH
        return {
          ...fileTree,
          opened: true,
          width: width === 260 ? DEFAULT_FILE_TREE_WIDTH : width,
          tab: "changes",
        }
      })()

      const migratedReview = (() => {
        if (!isRecord(review)) return review
        if (typeof review.panelOpened === "boolean") return review

        const opened = isRecord(fileTree) && typeof fileTree.opened === "boolean" ? fileTree.opened : true
        return {
          ...review,
          panelOpened: opened,
        }
      })()

      const sessionTabs = migrateLegacySessionStateKeys(value.sessionTabs)
      const sessionView = migrateLegacySessionStateKeys(value.sessionView)
      const migratedSessionTabs = (() => {
        if (!isRecord(sessionTabs)) return sessionTabs

        let changed = false
        const next = Object.fromEntries(
          Object.entries(sessionTabs).map(([key, tabs]) => {
            if (!isRecord(tabs) || !Array.isArray(tabs.all)) return [key, tabs]

            const current = {
              all: tabs.all.filter((tab): tab is string => typeof tab === "string"),
              active: typeof tabs.active === "string" ? tabs.active : undefined,
            }
            const normalized = normalizeStoredSessionTabs(key, current)
            if (current.all.length !== tabs.all.length) changed = true
            if (!same(current.all, normalized.all) || current.active !== normalized.active) changed = true
            if (tabs.active !== undefined && typeof tabs.active !== "string") changed = true
            return [key, normalized]
          }),
        )

        if (!changed) return sessionTabs
        return next
      })()

      if (
        migratedSidebar === sidebar &&
        migratedReview === review &&
        migratedFileTree === fileTree &&
        migratedSessionTabs === value.sessionTabs &&
        sessionView === value.sessionView
      ) {
        return value
      }

      return {
        ...value,
        sidebar: migratedSidebar,
        review: migratedReview,
        fileTree: migratedFileTree,
        sessionTabs: migratedSessionTabs,
        sessionView,
      }
    }

    const target = Persist.serverGlobal(serverSdk().scope, "layout", ["layout.v6"])
    const [store, setStore, _, ready] = persisted(
      { ...target, migrate },
      createStore({
        sidebar: {
          opened: false,
          width: DEFAULT_SIDEBAR_WIDTH,
          workspaces: {} as Record<string, boolean>,
          workspacesDefault: false,
        },
        terminal: {
          height: DEFAULT_TERMINAL_HEIGHT,
          opened: false,
        },
        review: {
          diffStyle: "split" as ReviewDiffStyle,
          panelOpened: true,
        },
        fileTree: {
          // FORK-BEGIN: 新用户默认展开 + tab 默认所有文件 [feat: file-tree-ux-polish] 2026-05-04
          opened: true,
          width: DEFAULT_FILE_TREE_WIDTH,
          tab: "all" as "changes" | "all",
          // FORK-END
        },
        session: {
          width: DEFAULT_SESSION_WIDTH,
        },
        mobileSidebar: {
          opened: false,
        },
        sessionTabs: {} as Record<string, SessionTabs>,
        // FORK: REQ-041 后续 — 文件 tab 改项目级存储(key=项目 dir),切会话保持不变;
        // 旧 sessionTabs(会话级)不再写入,自然废弃。2026-06-02
        projectTabs: {} as Record<string, SessionTabs>,
        sessionView: {} as Record<string, SessionView>,
        // FORK: 保留上游 handoff(跨 server tab 交接,submit/session 仍用)与 fork projectTabs 共存 [feat: electron-replatform]
        handoff: {
          tabs: undefined as TabHandoff | undefined,
        },
      }),
    )

    const MAX_SESSION_KEYS = 50
    const PENDING_MESSAGE_TTL_MS = 2 * 60 * 1000
    const usage = {
      active: undefined as string | undefined,
      pruned: false,
      used: new Map<string, number>(),
    }

    const SESSION_STATE_KEYS = [
      { key: "prompt", legacy: "prompt", version: "v2" },
      { key: "terminal", legacy: "terminal", version: "v1" },
      { key: "file-view", legacy: "file", version: "v1" },
    ] as const

    const dropSessionState = (keys: string[]) => {
      for (const key of keys) {
        const scope = SessionStateKey.scope(key)
        const parts = SessionStateKey.route(key).split("/")
        const dir = parts[0]
        const session = parts[1]
        if (!dir) continue

        for (const entry of SESSION_STATE_KEYS) {
          const target = session
            ? Persist.serverSession(scope, dir, session, entry.key)
            : Persist.serverWorkspace(scope, dir, entry.key)
          void removePersisted(target, platform)

          if (scope !== ServerScope.local) continue
          const legacyKey = `${dir}/${entry.legacy}${session ? "/" + session : ""}.${entry.version}`
          void removePersisted({ key: legacyKey }, platform)
        }
      }
    }

    function prune(keep?: string) {
      const drop = pruneSessionKeys({
        keep,
        max: MAX_SESSION_KEYS,
        used: usage.used,
        view: Object.keys(store.sessionView),
        tabs: Object.keys(store.sessionTabs),
      })
      if (drop.length === 0) return

      setStore(
        produce((draft) => {
          for (const key of drop) {
            delete draft.sessionView[key]
            delete draft.sessionTabs[key]
          }
        }),
      )

      scroll.drop(drop)
      dropSessionState(drop)

      for (const key of drop) {
        usage.used.delete(key)
      }
    }

    function touch(sessionKey: string) {
      usage.active = sessionKey
      usage.used.set(sessionKey, Date.now())

      if (!ready()) return
      if (usage.pruned) return

      usage.pruned = true
      prune(sessionKey)
    }

    const scroll = createScrollPersistence({
      debounceMs: 250,
      getSnapshot: (sessionKey) => store.sessionView[sessionKey]?.scroll,
      onFlush: (sessionKey, next) => {
        const current = store.sessionView[sessionKey]
        const keep = usage.active ?? sessionKey
        if (!current) {
          setStore("sessionView", sessionKey, { scroll: next })
          prune(keep)
          return
        }

        setStore("sessionView", sessionKey, "scroll", (prev) => ({ ...prev, ...next }))
        prune(keep)
      },
    })

    const ensureKey = (key: string) => ensureSessionKey(key, touch, (sessionKey) => scroll.seed(sessionKey))

    createEffect(() => {
      if (!ready()) return
      if (usage.pruned) return
      const active = usage.active
      if (!active) return
      usage.pruned = true
      prune(active)
    })

    onMount(() => {
      const flush = () => batch(() => scroll.flushAll())
      const handleVisibility = () => {
        if (document.visibilityState !== "hidden") return
        flush()
      }

      makeEventListener(window, "pagehide", flush)
      makeEventListener(document, "visibilitychange", handleVisibility)

      onCleanup(() => {
        scroll.dispose()
      })
    })

    const [colors, setColors] = createStore<Record<string, AvatarColorKey>>({})
    const colorRequested = new Map<string, AvatarColorKey>()

    function pickAvailableColor(used: Set<string>): AvatarColorKey {
      const available = AVATAR_COLOR_KEYS.filter((c) => !used.has(c))
      if (available.length === 0) return AVATAR_COLOR_KEYS[Math.floor(Math.random() * AVATAR_COLOR_KEYS.length)]
      return available[Math.floor(Math.random() * available.length)]
    }

    function enrich(project: { worktree: string; expanded: boolean }) {
      const [childStore] = serverSync().child(project.worktree, { bootstrap: false })
      const projectID = childStore.project
      const metadata = projectID
        ? serverSync().data.project.find((x) => x.id === projectID)
        : serverSync().data.project.find((x) => x.worktree === project.worktree)

      // Preserve local icon override from per-workspace localStorage cache (childStore.icon).
      // Without this, different subdirectories of the same git repo would share the same
      // icon from the database instead of using their individual overrides.
      const base = { ...metadata, ...project }
      // FORK: project-avatar-save — 除 childStore.icon 外也读 childStore.projectMeta.icon.override。
      // 编辑对话框对无 id / global 项目走 globalSync.project.meta,override 只写进 projectMeta,
      // 旧 enrich 不读它 → 上传头像永久不显示。见 ./project-icon-override.ts [feat: project-avatar-save]
      const override = resolveLocalIconOverride(childStore.icon, childStore.projectMeta)
      if (override) {
        return { ...base, icon: { ...base.icon, override } }
      }
      return base
    }

    const roots = createMemo(() => {
      const map = new Map<string, string>()
      for (const project of serverSync().data.project) {
        const sandboxes = project.sandboxes ?? []
        for (const sandbox of sandboxes) {
          map.set(sandbox, project.worktree)
        }
      }
      return map
    })

    const rootFor = (directory: string) => {
      const map = roots()
      if (map.size === 0) return directory

      const visited = new Set<string>()
      const chain = [directory]

      while (chain.length) {
        const current = chain[chain.length - 1]
        if (!current) return directory

        const next = map.get(current)
        if (!next) return current

        if (visited.has(next)) return directory
        visited.add(next)
        chain.push(next)
      }

      return directory
    }

    createEffect(() => {
      const projects = server.projects.list()
      const seen = new Set(projects.map((project) => project.worktree))

      batch(() => {
        for (const project of projects) {
          const root = rootFor(project.worktree)
          if (root === project.worktree) continue

          // FORK: REQ-072 复制项目独立展示 — 实例已实证该目录自身就是项目根(副本自带 .git/锚,
          // /path 上报 worktree === 目录)→ 不折叠进原项目;旧版误登记的 sandboxes 由后端打开时自愈。2026-07-05
          const [child] = serverSync().child(project.worktree, { bootstrap: false })
          if (child.path?.worktree === project.worktree) continue

          server.projects.close(project.worktree)

          if (!seen.has(root)) {
            server.projects.open(root)
            seen.add(root)
          }

          if (project.expanded) server.projects.expand(root)
        }
      })
    })

    const enriched = createMemo(() => server.projects.list().map(enrich))

    // FORK: REQ-072 — 项目打开后其 id 已知(enrich 从 childStore.project + 后端 metadata 合出),
    // 回写持久化到 StoredProject.id。改名后旧文件夹消失读不到锚,靠这个记住身份做兄弟目录锚扫描 relocate。
    // setId 内部仅在 id 变化时写,避免反复 setStore。 [feat: project-continuity-v2026-8-4] 2026-07-05
    createEffect(() => {
      for (const project of enriched()) {
        if (project.id && project.id !== "global") server.projects.setId(project.worktree, project.id)
      }
    })

    const list = createMemo(() => {
      const projects = enriched()
      return projects.map((project) => {
        const color = project.icon?.color ?? colors[project.worktree]
        if (!color) return project
        const icon = project.icon ? { ...project.icon, color } : { color }
        return { ...project, icon }
      })
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return
      if (!serverSync().ready) return

      for (const project of projects) {
        if (!project.id) continue
        if (project.id === "global") continue
        serverSync().project.icon(project.worktree, project.icon?.override)
      }
    })

    createEffect(() => {
      const projects = enriched()
      if (projects.length === 0) return

      for (const project of projects) {
        if (project.icon?.color) colorRequested.delete(project.worktree)
      }

      const used = new Set<string>()
      for (const project of projects) {
        const color = project.icon?.color ?? colors[project.worktree]
        if (color) used.add(color)
      }

      for (const project of projects) {
        if (project.icon?.color || project.icon?.override || project.icon?.url) continue
        const worktree = project.worktree
        const existing = colors[worktree]
        const color = existing ?? pickAvailableColor(used)
        if (!existing) {
          used.add(color)
          setColors(worktree, color)
        }
        if (!project.id) continue

        const requested = colorRequested.get(worktree)
        if (requested === color) continue
        colorRequested.set(worktree, color)

        if (project.id === "global") {
          serverSync().project.meta(worktree, { icon: { color } })
          continue
        }

        void serverSdk()
          .client.project.update({ projectID: project.id, directory: worktree, icon: { color } })
          .catch(() => {
            if (colorRequested.get(worktree) === color) colorRequested.delete(worktree)
          })
      }
    })

    let sessionFrame: number | undefined
    let sessionTimer: number | undefined

    onMount(() => {
      sessionFrame = requestAnimationFrame(() => {
        sessionFrame = undefined
        sessionTimer = window.setTimeout(() => {
          sessionTimer = undefined
          void Promise.all(
            server.projects.list().map((project) => {
              return serverSync().project.loadSessions(project.worktree)
            }),
          )
        }, 0)
      })
    })

    onCleanup(() => {
      if (sessionFrame !== undefined) cancelAnimationFrame(sessionFrame)
      if (sessionTimer !== undefined) window.clearTimeout(sessionTimer)
    })

    return {
      route,
      ready,
      handoff: {
        tabs: createMemo(() => store.handoff?.tabs),
        setTabs(dir: string, id: string) {
          setStore("handoff", "tabs", { scope: server.scope(), dir, id, at: Date.now() })
        },
        clearTabs() {
          if (!store.handoff?.tabs) return
          setStore("handoff", "tabs", undefined)
        },
      },
      projects: {
        list,
        open(directory: string) {
          const root = rootFor(directory)
          if (server.projects.list().find((x) => x.worktree === root)) return
          void serverSync().project.loadSessions(root)
          server.projects.open(root)
        },
        close(directory: string) {
          server.projects.close(directory)
          // FORK: REQ-042 #2 — 移除项目时删掉它的项目级文件 tab,避免残留;否则重新添加同目录会复活
          // 旧标签(可能指向已删/改名的文件)。projectTabs 的 key = 路由 dir = base64Encode(worktree)。2026-06-02
          const tabKey = base64Encode(directory)
          if (store.projectTabs[tabKey]) {
            setStore(
              "projectTabs",
              produce((draft) => {
                delete draft[tabKey]
              }),
            )
          }
        },
        expand(directory: string) {
          server.projects.expand(directory)
        },
        collapse(directory: string) {
          server.projects.collapse(directory)
        },
        move(directory: string, toIndex: number) {
          server.projects.move(directory, toIndex)
        },
      },
      sidebar: {
        opened: createMemo(() => store.sidebar.opened),
        open() {
          setStore("sidebar", "opened", true)
        },
        close() {
          setStore("sidebar", "opened", false)
        },
        toggle() {
          setStore("sidebar", "opened", (x) => !x)
        },
        width: createMemo(() => store.sidebar.width),
        resize(width: number) {
          setStore("sidebar", "width", width)
        },
        workspaces(directory: string) {
          return () => store.sidebar.workspaces[directory] ?? store.sidebar.workspacesDefault ?? false
        },
        setWorkspaces(directory: string, value: boolean) {
          setStore("sidebar", "workspaces", directory, value)
        },
        toggleWorkspaces(directory: string) {
          const current = store.sidebar.workspaces[directory] ?? store.sidebar.workspacesDefault ?? false
          setStore("sidebar", "workspaces", directory, !current)
        },
      },
      terminal: {
        height: createMemo(() => store.terminal.height),
        resize(height: number) {
          setStore("terminal", "height", height)
        },
      },
      review: {
        diffStyle: createMemo(() => store.review?.diffStyle ?? "split"),
        setDiffStyle(diffStyle: ReviewDiffStyle) {
          if (!store.review) {
            setStore("review", { diffStyle, panelOpened: true })
            return
          }
          setStore("review", "diffStyle", diffStyle)
        },
      },
      fileTree: {
        opened: createMemo(() => store.fileTree?.opened ?? true),
        width: createMemo(() => store.fileTree?.width ?? DEFAULT_FILE_TREE_WIDTH),
        tab: createMemo(() => store.fileTree?.tab ?? "all"), // FORK: 默认 tab 改 all [feat: file-tree-ux-polish] 2026-05-04
        setTab(tab: "changes" | "all") {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab })
            return
          }
          setStore("fileTree", "tab", tab)
        },
        // FORK-BEGIN: 4 处 fallback 内默认 tab 改 all,与初始 state 一致 [feat: file-tree-ux-polish] 2026-05-04
        open() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab: "all" })
            return
          }
          setStore("fileTree", "opened", true)
        },
        close() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: false, width: DEFAULT_FILE_TREE_WIDTH, tab: "all" })
            return
          }
          setStore("fileTree", "opened", false)
        },
        toggle() {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width: DEFAULT_FILE_TREE_WIDTH, tab: "all" })
            return
          }
          setStore("fileTree", "opened", (x) => !x)
        },
        resize(width: number) {
          if (!store.fileTree) {
            setStore("fileTree", { opened: true, width, tab: "all" })
            return
          }
          setStore("fileTree", "width", width)
        },
        // FORK-END
      },
      session: {
        width: createMemo(() => store.session?.width ?? DEFAULT_SESSION_WIDTH),
        resize(width: number) {
          if (!store.session) {
            setStore("session", { width })
            return
          }
          setStore("session", "width", width)
        },
      },
      mobileSidebar: {
        opened: createMemo(() => store.mobileSidebar?.opened ?? false),
        show() {
          setStore("mobileSidebar", "opened", true)
        },
        hide() {
          setStore("mobileSidebar", "opened", false)
        },
        toggle() {
          setStore("mobileSidebar", "opened", (x) => !x)
        },
      },
      pendingMessage: {
        set(sessionKey: string, messageID: string) {
          const at = Date.now()
          touch(sessionKey)
          const current = store.sessionView[sessionKey]
          if (!current) {
            setStore("sessionView", sessionKey, {
              scroll: {},
              pendingMessage: messageID,
              pendingMessageAt: at,
            })
            prune(usage.active ?? sessionKey)
            return
          }

          setStore(
            "sessionView",
            sessionKey,
            produce((draft) => {
              draft.pendingMessage = messageID
              draft.pendingMessageAt = at
            }),
          )
        },
        consume(sessionKey: string) {
          const current = store.sessionView[sessionKey]
          const message = current?.pendingMessage
          const at = current?.pendingMessageAt
          if (!message || !at) return

          setStore(
            "sessionView",
            sessionKey,
            produce((draft) => {
              delete draft.pendingMessage
              delete draft.pendingMessageAt
            }),
          )

          if (Date.now() - at > PENDING_MESSAGE_TTL_MS) return
          return message
        },
      },
      view(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        const s = createMemo(() => store.sessionView[key()] ?? { scroll: {} })
        const terminalOpened = createMemo(() => store.terminal?.opened ?? false)
        const reviewPanelOpened = createMemo(() => store.review?.panelOpened ?? true)

        function setTerminalOpened(next: boolean) {
          const current = store.terminal
          if (!current) {
            setStore("terminal", { height: DEFAULT_TERMINAL_HEIGHT, opened: next })
            return
          }

          const value = current.opened ?? false
          if (value === next) return
          setStore("terminal", "opened", next)
        }

        function setReviewPanelOpened(next: boolean) {
          const current = store.review
          if (!current) {
            setStore("review", { diffStyle: "split" as ReviewDiffStyle, panelOpened: next })
            return
          }

          const value = current.panelOpened ?? true
          if (value === next) return
          setStore("review", "panelOpened", next)
        }

        return {
          scroll(tab: string) {
            return scroll.scroll(key(), tab)
          },
          setScroll(tab: string, pos: SessionScroll) {
            scroll.setScroll(key(), tab, pos)
          },
          todoCollapsed: {
            get: () => s().todoCollapsed ?? false,
            set(collapsed: boolean) {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, { scroll: {}, todoCollapsed: collapsed })
              } else {
                setStore("sessionView", session, "todoCollapsed", collapsed)
              }
            },
          },
          terminal: {
            opened: terminalOpened,
            open() {
              setTerminalOpened(true)
            },
            close() {
              setTerminalOpened(false)
            },
            toggle() {
              setTerminalOpened(!terminalOpened())
            },
          },
          reviewPanel: {
            opened: reviewPanelOpened,
            open() {
              setReviewPanelOpened(true)
            },
            close() {
              setReviewPanelOpened(false)
            },
            toggle() {
              setReviewPanelOpened(!reviewPanelOpened())
            },
          },
          review: {
            open: createMemo(() => s().reviewOpen ?? []),
            setOpen(open: string[]) {
              const session = key()
              const next = Array.from(new Set(open))
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: next,
                })
                return
              }

              if (same(current.reviewOpen, next)) return
              setStore("sessionView", session, "reviewOpen", next)
            },
            openPath(path: string) {
              const session = key()
              const current = store.sessionView[session]
              if (!current) {
                setStore("sessionView", session, {
                  scroll: {},
                  reviewOpen: [path],
                })
                return
              }

              if (!current.reviewOpen) {
                setStore("sessionView", session, "reviewOpen", [path])
                return
              }

              if (current.reviewOpen.includes(path)) return
              setStore("sessionView", session, "reviewOpen", current.reviewOpen.length, path)
            },
            closePath(path: string) {
              const session = key()
              const current = store.sessionView[session]?.reviewOpen
              if (!current) return

              const index = current.indexOf(path)
              if (index === -1) return
              setStore(
                "sessionView",
                session,
                "reviewOpen",
                produce((draft) => {
                  if (!draft) return
                  draft.splice(index, 1)
                }),
              )
            },
            togglePath(path: string) {
              const session = key()
              const current = store.sessionView[session]?.reviewOpen
              if (!current || !current.includes(path)) {
                this.openPath(path)
                return
              }

              this.closePath(path)
            },
          },
        }
      },
      tabs(sessionKey: string | Accessor<string>) {
        const key = createSessionKeyReader(sessionKey, ensureKey)
        // FORK-BEGIN: REQ-041/042 — 文件 tab 按项目(dir)存 projectTabs[dir](切会话保持);
        // 「审查/上下文」是会话级伪标签(active + context-open),存 sessionView[sessionKey].tab,
        // 不跟项目级文件 tab 串味。对外 { all, active } 形状不变,下游(helpers/session-side-panel)零改。2026-06-02
        const projectKey = createMemo(() => projectTabKey(key()))
        const path = createMemo(() => sessionPath(key()))
        const files = createMemo<SessionTabs>(() => store.projectTabs[projectKey()] ?? { all: [] })
        const pseudo = createMemo(() => store.sessionView[key()]?.tab)
        const tabs = createMemo<SessionTabs>(() => synthTabs(files(), pseudo()))
        const normalize = (tab: string) => normalizeSessionTab(path(), tab)
        const normalizeAll = (all: string[]) => normalizeSessionTabList(path(), all)

        const setFileActive = (active: string | undefined) => {
          const pk = projectKey()
          if (!store.projectTabs[pk]) setStore("projectTabs", pk, { all: [], active })
          else setStore("projectTabs", pk, "active", active)
        }
        const setFileAll = (all: string[]) => {
          const pk = projectKey()
          if (!store.projectTabs[pk]) setStore("projectTabs", pk, { all })
          else setStore("projectTabs", pk, "all", all)
        }
        const setPseudo = (patch: Partial<SessionPseudoTab>) => {
          const sk = key()
          if (!store.sessionView[sk]) setStore("sessionView", sk, { scroll: {}, tab: { ...patch } })
          else setStore("sessionView", sk, "tab", (prev) => ({ ...prev, ...patch }))
        }

        return {
          tabs,
          active: createMemo(() => tabs().active),
          all: createMemo(() => tabs().all.filter((tab) => tab !== "review")),
          setActive(tab: string | undefined) {
            const next = tab ? normalize(tab) : tab
            if (next === "review") return setPseudo({ active: "review" })
            if (next === "context") return setPseudo({ active: "context", context: true })
            // 文件 tab(或 undefined):项目级 active + 离开会话伪标签
            setFileActive(next)
            setPseudo({ active: undefined })
          },
          setAll(all: string[]) {
            // 仅设文件 tab 列表(项目级);伪标签(review/context)不进文件存储
            setFileAll(normalizeAll(all).filter((tab) => tab !== "review" && tab !== "context"))
          },
          async open(tab: string) {
            const n = normalize(tab)
            if (n === "review") return setPseudo({ active: "review" })
            if (n === "context") return setPseudo({ active: "context", context: true })
            // 打开文件:加入项目级文件 tab + active;离开会话伪标签
            setStore("projectTabs", projectKey(), nextSessionTabsForOpen(store.projectTabs[projectKey()], n))
            setPseudo({ active: undefined })
          },
          close(tab: string) {
            if (tab === "review") {
              if (store.sessionView[key()]?.tab?.active === "review") setPseudo({ active: undefined })
              return
            }
            if (tab === "context") {
              const wasActive = store.sessionView[key()]?.tab?.active === "context"
              setPseudo(wasActive ? { context: false, active: undefined } : { context: false })
              return
            }
            // 文件 tab
            const pk = projectKey()
            const current = store.projectTabs[pk]
            if (!current) return
            const all = current.all.filter((x) => x !== tab)
            if (current.active !== tab) {
              setStore("projectTabs", pk, "all", all)
              return
            }
            const index = current.all.findIndex((f) => f === tab)
            const next = current.all[index - 1] ?? current.all[index + 1] ?? all[0]
            batch(() => {
              setStore("projectTabs", pk, "all", all)
              setStore("projectTabs", pk, "active", next)
            })
          },
          move(tab: string, to: number) {
            const pk = projectKey()
            const current = store.projectTabs[pk]
            if (!current) return
            const index = current.all.findIndex((f) => f === tab)
            if (index === -1) return
            setStore(
              "projectTabs",
              pk,
              "all",
              produce((opened) => {
                opened.splice(to, 0, opened.splice(index, 1)[0])
              }),
            )
          },
        }
        // FORK-END
      },
    }
  },
})
