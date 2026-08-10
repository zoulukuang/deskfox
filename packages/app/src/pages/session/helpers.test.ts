import { describe, expect, test } from "bun:test"
import { createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import {
  closeOtherTabs,
  createOpenReviewFile,
  createOpenSessionFileTab,
  createSessionTabs,
  focusTerminalById,
  getTabReorderIndex,
  shouldFocusTerminalOnKeyDown,
  shouldShowFileTree,
} from "./helpers"

describe("shouldShowFileTree", () => {
  test("does not reserve space for a disabled file tree", () => {
    expect(shouldShowFileTree({ visible: false, opened: true })).toBe(false)
    expect(shouldShowFileTree({ visible: true, opened: true })).toBe(true)
  })
})

describe("createOpenReviewFile", () => {
  test("opens and loads selected review file", () => {
    const calls: string[] = []
    const openReviewFile = createOpenReviewFile({
      showAllFiles: () => calls.push("show"),
      tabForPath: (path) => {
        calls.push(`tab:${path}`)
        return `file://${path}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      setActive: (tab) => calls.push(`active:${tab}`),
      loadFile: (path) => calls.push(`load:${path}`),
    })

    openReviewFile("src/a.ts")

    expect(calls).toEqual(["show", "load:src/a.ts", "tab:src/a.ts", "open:file://src/a.ts", "active:file://src/a.ts"])
  })
})

describe("createOpenSessionFileTab", () => {
  test("activates the opened file tab", () => {
    const calls: string[] = []
    const openTab = createOpenSessionFileTab({
      normalizeTab: (value) => {
        calls.push(`normalize:${value}`)
        return `file://${value}`
      },
      openTab: (tab) => calls.push(`open:${tab}`),
      pathFromTab: (tab) => {
        calls.push(`path:${tab}`)
        return tab.slice("file://".length)
      },
      loadFile: (path) => calls.push(`load:${path}`),
      openReviewPanel: () => calls.push("review"),
      setActive: (tab) => calls.push(`active:${tab}`),
    })

    openTab("src/a.ts")

    expect(calls).toEqual([
      "normalize:src/a.ts",
      "open:file://src/a.ts",
      "path:file://src/a.ts",
      "load:src/a.ts",
      "review",
      "active:file://src/a.ts",
    ])
  })
  // FORK: 文件树点击 toggle — 再次点击正在查看的文件收起查看面板 [fix: filetree-toggle] 2026-06-04
  test("toggle: re-clicking the active file while viewer open closes the viewer", () => {
    const calls: string[] = []
    const openTab = createOpenSessionFileTab({
      normalizeTab: (value) => `file://${value}`,
      openTab: (tab) => calls.push(`open:${tab}`),
      pathFromTab: (tab) => tab.slice("file://".length),
      loadFile: (path) => calls.push(`load:${path}`),
      openReviewPanel: () => calls.push("review"),
      setActive: (tab) => calls.push(`active:${tab}`),
      activeFileTab: () => "file://src/a.ts", // 当前正在查看 a.ts
      isViewerOpen: () => true, // 查看面板已打开
      closeViewer: () => calls.push("closeViewer"),
    })

    openTab("src/a.ts")

    // 只收起面板,不重新打开/激活
    expect(calls).toEqual(["closeViewer"])
  })

  test("toggle: clicking a different file opens it normally (no close)", () => {
    const calls: string[] = []
    const openTab = createOpenSessionFileTab({
      normalizeTab: (value) => `file://${value}`,
      openTab: (tab) => calls.push(`open:${tab}`),
      pathFromTab: (tab) => tab.slice("file://".length),
      loadFile: (path) => calls.push(`load:${path}`),
      openReviewPanel: () => calls.push("review"),
      setActive: (tab) => calls.push(`active:${tab}`),
      activeFileTab: () => "file://src/a.ts", // 正在查看 a.ts
      isViewerOpen: () => true,
      closeViewer: () => calls.push("closeViewer"),
    })

    openTab("src/b.ts") // 点的是另一个文件 b.ts

    expect(calls).toEqual(["open:file://src/b.ts", "load:src/b.ts", "review", "active:file://src/b.ts"])
  })

  test("toggle: clicking active file while viewer closed re-opens it (no toggle-close)", () => {
    const calls: string[] = []
    const openTab = createOpenSessionFileTab({
      normalizeTab: (value) => `file://${value}`,
      openTab: (tab) => calls.push(`open:${tab}`),
      pathFromTab: (tab) => tab.slice("file://".length),
      loadFile: (path) => calls.push(`load:${path}`),
      openReviewPanel: () => calls.push("review"),
      setActive: (tab) => calls.push(`active:${tab}`),
      activeFileTab: () => "file://src/a.ts",
      isViewerOpen: () => false, // 面板已收起 → 再点应重新打开
      closeViewer: () => calls.push("closeViewer"),
    })

    openTab("src/a.ts")

    expect(calls).toEqual(["open:file://src/a.ts", "load:src/a.ts", "review", "active:file://src/a.ts"])
  })
})

describe("focusTerminalById", () => {
  test("focuses textarea when present", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-one"><div data-component="terminal"><textarea></textarea></div></div>`

    const focused = focusTerminalById("one")

    expect(focused).toBe(true)
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
  })

  test("falls back to terminal element focus", () => {
    document.body.innerHTML = `<div id="terminal-wrapper-two"><div data-component="terminal" tabindex="0"></div></div>`
    const terminal = document.querySelector('[data-component="terminal"]') as HTMLElement
    let pointerDown = false
    terminal.addEventListener("pointerdown", () => {
      pointerDown = true
    })

    const focused = focusTerminalById("two")

    expect(focused).toBe(true)
    expect(document.activeElement).toBe(terminal)
    expect(pointerDown).toBe(true)
  })
})

describe("shouldFocusTerminalOnKeyDown", () => {
  test("skips pure modifier keys", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Alt", altKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "Shift", shiftKey: true }))).toBe(false)
  })

  test("skips shortcut key combos", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "c", metaKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))).toBe(false)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true }))).toBe(false)
  })

  test("keeps plain typing focused on terminal", () => {
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "a" }))).toBe(true)
    expect(shouldFocusTerminalOnKeyDown(new KeyboardEvent("keydown", { key: "A", shiftKey: true }))).toBe(true)
  })
})

describe("getTabReorderIndex", () => {
  test("returns target index for valid drag reorder", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "c")).toBe(2)
  })

  test("returns undefined for unknown droppable id", () => {
    expect(getTabReorderIndex(["a", "b", "c"], "a", "missing")).toBeUndefined()
  })
})

describe("createSessionTabs", () => {
  test("normalizes the effective file tab", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: ["file://src/a.ts", "context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: (tab) => (tab.startsWith("file://") ? tab.slice("file://".length) : undefined),
        normalizeTab: (tab) => (tab.startsWith("file://") ? `norm:${tab.slice("file://".length)}` : tab),
      })

      expect(result.activeTab()).toBe("norm:src/a.ts")
      expect(result.activeFileTab()).toBe("norm:src/a.ts")
      expect(result.closableTab()).toBe("norm:src/a.ts")
      dispose()
    })
  })

  test("prefers context and review fallbacks when no file tab is active", () => {
    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: ["context"],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
        review: () => true,
        hasReview: () => true,
      })

      expect(result.activeTab()).toBe("context")
      expect(result.closableTab()).toBe("context")
      dispose()
    })

    createRoot((dispose) => {
      const [state] = createStore({
        active: undefined as string | undefined,
        all: [],
      })
      const tabs = createMemo(() => ({ active: () => state.active, all: () => state.all }))
      const result = createSessionTabs({
        tabs,
        pathFromTab: () => undefined,
        normalizeTab: (tab) => tab,
        review: () => true,
        hasReview: () => true,
      })

      expect(result.activeTab()).toBe("review")
      expect(result.activeFileTab()).toBeUndefined()
      expect(result.closableTab()).toBeUndefined()
      dispose()
    })
  })
})

describe("closeOtherTabs [feat: file-tab-close-others]", () => {
  test("closes every tab except the kept one, preserving order", () => {
    const closed: string[] = []
    closeOtherTabs(["a", "b", "c", "d"], "b", (t) => closed.push(t))
    expect(closed).toEqual(["a", "c", "d"])
  })

  test("keeps the kept tab even if duplicated, never closes it", () => {
    const closed: string[] = []
    closeOtherTabs(["a", "b", "b"], "b", (t) => closed.push(t))
    expect(closed).toEqual(["a"])
  })

  test("no-op when only the kept tab is open", () => {
    const closed: string[] = []
    closeOtherTabs(["solo"], "solo", (t) => closed.push(t))
    expect(closed).toEqual([])
  })

  test("no-op on empty list", () => {
    const closed: string[] = []
    closeOtherTabs([], "x", (t) => closed.push(t))
    expect(closed).toEqual([])
  })

  test("closes all when kept tab is not present", () => {
    const closed: string[] = []
    closeOtherTabs(["a", "b"], "missing", (t) => closed.push(t))
    expect(closed).toEqual(["a", "b"])
  })
})
