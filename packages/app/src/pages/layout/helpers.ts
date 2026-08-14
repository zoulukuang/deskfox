import { getFilename } from "@opencode-ai/core/util/path"
import { type Session } from "@opencode-ai/sdk/v2/client"
import { pathKey } from "@/utils/path-key"
import type { ServerConnection } from "@/context/server"
import type { HomeProjectSelection } from "@/context/layout"

type SessionStore = {
  session?: Session[]
  path: { directory: string }
}

export function compareSessionTime(a: Session, b: Session) {
  const updated = (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)
  if (updated !== 0) return updated
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const isRootVisibleSession = (session: Session, directory: string) =>
  pathKey(session.directory) === pathKey(directory) && !session.parentID && !session.time?.archived

export const roots = (store: SessionStore) =>
  (store.session ?? []).filter((session) => isRootVisibleSession(session, store.path.directory))

export const sortedRootSessions = (store: SessionStore, _now: number) => roots(store).sort(compareSessionTime)

// FORK-BEGIN: REQ-072 复制项目独立展示 — 无人认领的项目会话归主分节 2026-07-05
// scope=project 后每个目录 store 都持有全项目会话,分节靠 directory 认领去重;副本目录打开时,
// 共享会话的 directory 指向原目录(不在任何可见分节)→ 全部被滤掉 = "打开副本看不到会话"。
// 把可见分节都认领不了的根会话归入主分节,副本/原本双向都能看到共享会话,多工作区分节不重复。
// (2026-08-11 sync v1.18.16:排序随上游 sortSessions→compareSessionTime 时序化)
export const orphanRootSessions = (store: SessionStore, claimedDirs: string[], _now: number) => {
  const claimed = new Set(claimedDirs.map(pathKey))
  return (store.session ?? [])
    .filter((session) => !session.parentID && !session.time?.archived && !claimed.has(pathKey(session.directory)))
    .sort(compareSessionTime)
}
// FORK-END

export const latestRootSession = (stores: SessionStore[], _now: number) =>
  stores.flatMap(roots).sort(compareSessionTime)[0]

export function hasProjectPermissions<T>(
  request: Record<string, T[] | undefined> | undefined,
  include: (item: T) => boolean = () => true,
) {
  return Object.values(request ?? {}).some((list) => list?.some(include))
}

export const childSessionOnPath = (sessions: Session[] | undefined, rootID: string, activeID?: string) => {
  if (!activeID || activeID === rootID) return
  const map = new Map((sessions ?? []).map((session) => [session.id, session]))
  let id = activeID

  while (id) {
    const session = map.get(id)
    if (!session?.parentID) return
    if (session.parentID === rootID) return session
    id = session.parentID
  }
}

export const displayName = (project: { name?: string; worktree: string }) =>
  project.name || getFilename(project.worktree) || project.worktree

export function toggleHomeProjectSelection(
  current: HomeProjectSelection | undefined,
  server: ServerConnection.Key,
  directory: string,
): HomeProjectSelection {
  if (current?.server === server && current.directory === directory) return { server }
  return { server, directory }
}

export function closeHomeProject(
  selected: HomeProjectSelection | undefined,
  server: ServerConnection.Key,
  projects: { close: (directory: string) => void },
  directory: string,
) {
  projects.close(directory)
  if (selected?.server === server && selected.directory === directory) return { server }
  return selected
}

export function homeProjectNavigation(active: ServerConnection.Key, server: ServerConnection.Key, href: string) {
  if (active === server) return { href }
  return { server, href }
}

export function homeProjectDirectories(result: string | string[] | null) {
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

export function homeSessionServerStatus(active: boolean, status: () => { working: boolean; tint?: string }) {
  if (!active) return { working: false, tint: undefined }
  return status()
}

const OPENCODE_PROJECT_ID = "4b0ea68d7af9a6031a7ffda7ad66e0cb83315750"

export function getProjectAvatarSource(id?: string, icon?: { color?: string; url?: string; override?: string }) {
  if (id === OPENCODE_PROJECT_ID) return "https://opencode.ai/favicon.svg"
  if (icon?.override) return icon.override
  if (icon?.color) return undefined
  return icon?.url
}

export function projectForSession<T extends { id?: string; worktree: string; sandboxes?: string[] }>(
  session: Session,
  projects: T[],
  byID: Map<string, T> = new Map(projects.flatMap((project) => (project.id ? [[project.id, project] as const] : []))),
) {
  const direct = byID.get(session.projectID)
  if (direct) return direct
  return projectForDirectory(projects, session.directory)
}

// FORK-BEGIN: REQ-072 复制项目独立展示 — 目录→项目条目解析,自身条目优先 2026-07-05
// 复制出的目录与原项目共享身份(同锚/同 git 首commit),后端把它登记为原项目的 sandbox 目录。
// 若 sandbox 归属先于精确 worktree 匹配,打开副本会被解析成原项目条目 → 界面整体跳回原目录。
// 两段式:precise worktree 条目在(openProject 为所选目录建了条目)就留在所选目录;
// 纯 workspace sandbox(无独立条目,git worktrees 功能)仍走第二段归属原项目,不回归。
export function projectForDirectory<T extends { worktree: string; sandboxes?: string[] }>(
  projects: T[],
  directory: string,
): T | undefined {
  const key = pathKey(directory)
  const direct = projects.find((project) => pathKey(project.worktree) === key)
  if (direct) return direct
  return projects.find((project) => project.sandboxes?.some((sandbox) => pathKey(sandbox) === key))
}
// FORK-END

export const errorMessage = (err: unknown, fallback: string) => {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (err instanceof Error) return err.message
  return fallback
}

export const effectiveWorkspaceOrder = (local: string, dirs: string[], persisted?: string[]) => {
  const root = pathKey(local)
  const live = new Map<string, string>()

  for (const dir of dirs) {
    const key = pathKey(dir)
    if (key === root) continue
    if (!live.has(key)) live.set(key, dir)
  }

  if (!persisted?.length) return [local, ...live.values()]

  const result = [local]
  for (const dir of persisted) {
    const key = pathKey(dir)
    if (key === root) continue
    const match = live.get(key)
    if (!match) continue
    result.push(match)
    live.delete(key)
  }

  return [...result, ...live.values()]
}
