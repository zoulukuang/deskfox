import type { SelectedLineRange } from "@/context/file"

type HandoffSession = {
  prompt: string
  files: Record<string, SelectedLineRange | null>
}

// FORK: REQ-083 首启自动打开介绍文档 —— 全局单值待打开文件(相对项目根)。首启唯一场景,故不按
//   directory/sessionKey 做 key:既避开 fromLegacy/fromRoute 的 key 形态差异,也避开隔离测试里
//   /var 与 /private/var(macOS symlink,realpath 后)导致的目录精确匹配失败。session.tsx 第一次
//   项目就绪(sdk.directory)时取出并清空,走完整 openChatFileTab。[feat: first-launch-onboarding]
let pendingOpenFile: string | undefined

export const setPendingOpenFile = (file: string) => {
  pendingOpenFile = file
}

export const takePendingOpenFile = () => {
  const file = pendingOpenFile
  pendingOpenFile = undefined
  return file
}

const MAX = 40

const store = {
  session: new Map<string, HandoffSession>(),
  terminal: new Map<string, string[]>(),
}

const touch = <K, V>(map: Map<K, V>, key: K, value: V) => {
  map.delete(key)
  map.set(key, value)
  while (map.size > MAX) {
    const first = map.keys().next().value
    if (first === undefined) return
    map.delete(first)
  }
}

export const setSessionHandoff = (key: string, patch: Partial<HandoffSession>) => {
  const prev = store.session.get(key) ?? { prompt: "", files: {} }
  touch(store.session, key, { ...prev, ...patch })
}

export const getSessionHandoff = (key: string) => store.session.get(key)

export const setTerminalHandoff = (key: string, value: string[]) => {
  touch(store.terminal, key, value)
}

export const getTerminalHandoff = (key: string) => store.terminal.get(key)
