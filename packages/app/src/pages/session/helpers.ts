import { batch, createMemo, onCleanup, onMount, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { same } from "@/utils/same"
import { SESSION_OPEN_FILE_TAB } from "@/context/layout-tabs"

export { SESSION_OPEN_FILE_TAB } from "@/context/layout-tabs"

const emptyTabs: string[] = []

type Tabs = {
  active: Accessor<string | undefined>
  all: Accessor<string[]>
}

type TabsInput = {
  tabs: Accessor<Tabs>
  pathFromTab: (tab: string) => string | undefined
  normalizeTab: (tab: string) => string
  review?: Accessor<boolean>
  hasReview?: Accessor<boolean>
  fileBrowser?: Accessor<boolean>
}

export const getSessionKey = (dir: string | undefined, id: string | undefined) => `${dir ?? ""}${id ? `/${id}` : ""}`

export function shouldShowFileTree(input: { visible: boolean; opened: boolean }) {
  return input.opened && input.visible
}

export const createSessionTabs = (input: TabsInput) => {
  const review = input.review ?? (() => false)
  const hasReview = input.hasReview ?? (() => false)
  const fileBrowser = input.fileBrowser ?? (() => false)
  const contextOpen = createMemo(() => input.tabs().active() === "context" || input.tabs().all().includes("context"))
  const openFileOpen = createMemo(
    () =>
      fileBrowser() &&
      (input.tabs().active() === SESSION_OPEN_FILE_TAB || input.tabs().all().includes(SESSION_OPEN_FILE_TAB)),
  )
  const panelTabs = createMemo(
    () => {
      const seen = new Set<string>()
      return input
        .tabs()
        .all()
        .flatMap((tab) => {
          if (tab === "context" || tab === "review") return []
          if (tab === SESSION_OPEN_FILE_TAB && !fileBrowser()) return []
          const value = input.pathFromTab(tab) ? input.normalizeTab(tab) : tab
          if (seen.has(value)) return []
          seen.add(value)
          return [value]
        })
    },
    emptyTabs,
    { equals: same },
  )
  const openedTabs = createMemo(() => panelTabs().filter((tab) => tab !== SESSION_OPEN_FILE_TAB), emptyTabs, {
    equals: same,
  })
  const activeTab = createMemo(() => {
    const active = input.tabs().active()
    if (active === "context") return active
    if (active === SESSION_OPEN_FILE_TAB && openFileOpen()) return active
    if (active === "review" && review()) return active
    if (active && input.pathFromTab(active)) return input.normalizeTab(active)

    const first = openedTabs()[0]
    if (first) return first
    if (contextOpen()) return "context"
    if (review() && hasReview()) return "review"
    return "empty"
  })
  const activeFileTab = createMemo(() => {
    const active = activeTab()
    if (!openedTabs().includes(active)) return
    return active
  })
  const closableTab = createMemo(() => {
    const active = activeTab()
    if (active === "context") return active
    if (active === SESSION_OPEN_FILE_TAB && openFileOpen()) return active
    if (!openedTabs().includes(active)) return
    return active
  })

  return {
    contextOpen,
    openFileOpen,
    panelTabs,
    openedTabs,
    activeTab,
    activeFileTab,
    closableTab,
  }
}

export const focusTerminalById = (id: string) => {
  const wrapper = document.getElementById(`terminal-wrapper-${id}`)
  const terminal = wrapper?.querySelector('[data-component="terminal"]')
  if (!(terminal instanceof HTMLElement)) return false

  const textarea = terminal.querySelector("textarea")
  if (textarea instanceof HTMLTextAreaElement) {
    textarea.focus()
    return true
  }

  terminal.focus()
  terminal.dispatchEvent(
    typeof PointerEvent === "function"
      ? new PointerEvent("pointerdown", { bubbles: true, cancelable: true })
      : new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
  )
  return true
}

export const createOpenReviewFile = (input: {
  showAllFiles: () => void
  tabForPath: (path: string) => string
  openTab: (tab: string) => void
  setActive: (tab: string) => void
  loadFile: (path: string) => any | Promise<void>
}) => {
  return (path: string) => {
    batch(() => {
      input.showAllFiles()
      const maybePromise = input.loadFile(path)
      const open = () => {
        const tab = input.tabForPath(path)
        input.openTab(tab)
        input.setActive(tab)
      }
      if (maybePromise instanceof Promise) void maybePromise.then(open)
      else open()
    })
  }
}

export const createOpenSessionFileTab = (input: {
  normalizeTab: (tab: string) => string
  openTab: (tab: string) => void
  pathFromTab: (tab: string) => string | undefined
  loadFile: (path: string) => void
  openReviewPanel: () => void
  setActive: (tab: string) => void
  // FORK-BEGIN: 文件树点击 toggle — 再次点击正在查看的文件时收起查看面板 [fix: filetree-toggle] 2026-06-04
  activeFileTab?: () => string | undefined
  isViewerOpen?: () => boolean
  closeViewer?: () => void
  // FORK-END
}) => {
  return (value: string) => {
    const next = input.normalizeTab(value)

    // FORK-BEGIN: toggle 关闭 — 点击的若正是「当前激活 + 查看面板已打开」的文件,收起面板不重开
    // (pathFromTab 放最后:无 toggle 参数时前面短路,不多调一次 pathFromTab,保持原行为/测试不变;
    //  只对真实文件 tab 生效 — review/context 等非文件 tab 的 pathFromTab 为空)
    if (input.closeViewer && input.isViewerOpen?.() && input.activeFileTab?.() === next && input.pathFromTab(next)) {
      input.closeViewer()
      return
    }
    // FORK-END

    input.openTab(next)

    const path = input.pathFromTab(next)
    if (!path) return

    input.loadFile(path)
    input.openReviewPanel()
    input.setActive(next)
  }
}

export const getTabReorderIndex = (tabs: readonly string[], from: string, to: string) => {
  const fromIndex = tabs.indexOf(from)
  const toIndex = tabs.indexOf(to)
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return undefined
  return toIndex
}

// FORK: tab 右键「关闭其他标签」逻辑 — 关掉除 keep 外的所有已开 tab(保持顺序遍历)。
//   纯函数便于单测;UI 在 session-sortable-tab.tsx 右键菜单触发,close 由 caller 传(tabs().close)。
//   [feat: file-tab-close-others] 2026-06-09
export const closeOtherTabs = (tabs: readonly string[], keep: string, close: (tab: string) => void) => {
  for (const tab of tabs) {
    if (tab !== keep) close(tab)
  }
}

export const createSizing = () => {
  const [state, setState] = createStore({ active: false })
  let t: number | undefined

  const stop = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", false)
  }

  const start = () => {
    if (t !== undefined) {
      clearTimeout(t)
      t = undefined
    }
    setState("active", true)
  }

  onMount(() => {
    makeEventListener(window, "pointerup", stop)
    makeEventListener(window, "pointercancel", stop)
    makeEventListener(window, "blur", stop)
  })

  onCleanup(() => {
    if (t !== undefined) clearTimeout(t)
  })

  return {
    active: () => state.active,
    start,
    touch() {
      start()
      t = window.setTimeout(stop, 120)
    },
  }
}

export type Sizing = ReturnType<typeof createSizing>

// FORK: 段3 上游删除,本地保留(终端聚焦键判定)[feat: iconbar-left-decouple]
const terminalFocusSkip = new Set(["Alt", "Control", "Meta", "Shift"])
export const shouldFocusTerminalOnKeyDown = (event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">) => {
  if (terminalFocusSkip.has(event.key)) return false
  return !(event.ctrlKey || event.metaKey || event.altKey)
}
