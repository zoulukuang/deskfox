import { For, Match, Show, Switch, createEffect, createMemo, on, onCleanup, type JSX } from "solid-js"
// FORK: 文件树宽度唯一事实源 [feat: file-tree-width-single-source] 2026-08-13
import { FILE_TREE_WIDTH_MIN, resolvedFileTreeWidth } from "./file-tree-width"
// FORK: REQ-111 [feat: session-presentation-input-batch] 2026-08-17
import { decideTabCollapse, TAB_COLLAPSE_DEFER_MS } from "./session-tab-collapse"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { DragDropProvider as DndKitProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { Tabs } from "@opencode-ai/ui/tabs"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { TooltipKeybind } from "@opencode-ai/ui/tooltip"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Mark } from "@opencode-ai/ui/logo"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { KeybindV2 } from "@opencode-ai/ui/v2/keybind-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import type { FileDiffInfo } from "@opencode-ai/client/promise"
import { ConstrainDragYAxis, getDraggableId } from "@/utils/solid-dnd"
import { useDialog } from "@opencode-ai/ui/context/dialog"

import FileTree from "@/components/file-tree"
import { normalizeFileTreeV2Path } from "@/components/file-tree-v2-model"
import { SessionContextUsage } from "@/components/session-context-usage"

const reviewTabID = "session-side-panel-review-tab"
const reviewTabPanelID = "session-side-panel-review-tabpanel"
const fileBrowserTabPanelID = "session-side-panel-file-browser-tabpanel"
import { SessionContextTab, SortableTab, SortableTabV2, FileVisual } from "@/components/session"
import { OpenInAppV2 } from "@/components/session/open-in-app-v2"
import { useCommand } from "@/context/command"
import { useFile, type SelectedLineRange } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSDK } from "@/context/sdk"
import { useSettings } from "@/context/settings"
import { createFileTabListSync } from "@/pages/session/file-tab-scroll"
import { FileTabContent } from "@/pages/session/file-tabs"
import {
  SESSION_OPEN_FILE_TAB,
  // FORK: 右键「关闭其他标签」的实现(helper 一直在,2026-08 上游 merge 把调用点冲掉了)
  // [feat: file-tab-close-others] 2026-08-12
  closeOtherTabs,
  createOpenSessionFileTab,
  createSessionTabs,
  getTabReorderIndex,
  shouldShowFileTree,
  type Sizing,
} from "@/pages/session/helpers"
import { setSessionHandoff } from "@/pages/session/handoff"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useSync } from "@/context/sync"
import { SessionFileBrowserTab, type SessionFileBrowserState } from "@/pages/session/v2/session-file-browser-tab"

type ReviewDiff = FileDiffInfo | SnapshotFileDiff | VcsFileDiff
type RenderDiff = FileDiffInfo | (SnapshotFileDiff & { file: string }) | VcsFileDiff
// FORK: 文件树宽度改由唯一事实源提供 —— 侧面板与聊天区必须同取一个值,否则溢出
//   [feat: file-tree-width-single-source] 2026-08-13
// (原地定义已移到 ./file-tree-width.ts,此处保留同名 re-export 以免大面积改动)

function renderDiff(value: ReviewDiff): value is RenderDiff {
  return typeof value.file === "string"
}

export function SessionSidePanel(props: {
  canReview: () => boolean
  diffs: () => ReviewDiff[]
  diffsReady: () => boolean
  empty: () => string
  hasReview: () => boolean
  reviewHasFocusableContent: () => boolean
  reviewCount: () => number
  reviewPanel: () => JSX.Element
  reviewSidebarToggle?: (disabled: boolean) => JSX.Element
  fileBrowserState?: SessionFileBrowserState
  activeDiff?: string
  focusReviewDiff: (path: string) => void
  reviewSnap: boolean
  size: Sizing
  stacked?: boolean
}) {
  const layout = useLayout()
  const settings = useSettings()
  const file = useFile()
  const language = useLanguage()
  const command = useCommand()
  const dialog = useDialog()
  const sdk = useSDK()
  const { sessionKey, tabs, view, params } = useSessionLayout()
  const projectDirectory = createMemo(() => sdk().directory)

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const shown = settings.visibility.fileTree

  const reviewOpen = createMemo(() => isDesktop() && view().reviewPanel.opened())
  const fileOpen = createMemo(
    () =>
      isDesktop() &&
      shouldShowFileTree({
        visible: shown(),
        opened: layout.fileTree.opened(),
      }),
  )
  const open = createMemo(() => reviewOpen() || fileOpen())
  const fileTreeWidth = createMemo(() => resolvedFileTreeWidth(layout.fileTree.width()))
  const reviewTab = createMemo(() => isDesktop())
  const panelWidth = createMemo(() => {
    if (!open()) return "0px"
    if (reviewOpen()) return "auto"
    return `${fileTreeWidth()}px`
  })
  const treeWidth = createMemo(() => (fileOpen() ? `${fileTreeWidth()}px` : "0px"))

  const diffs = createMemo(() => props.diffs().filter(renderDiff))
  const diffFiles = createMemo(() => diffs().map((d) => d.file))
  const kinds = createMemo(() => {
    const merge = (a: "add" | "del" | "mix" | undefined, b: "add" | "del" | "mix") => {
      if (!a) return b
      if (a === b) return a
      return "mix" as const
    }

    const out = new Map<string, "add" | "del" | "mix">()
    for (const diff of diffs()) {
      const file = normalizeFileTreeV2Path(diff.file)
      const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"

      out.set(file, kind)

      const parts = file.split("/")
      for (const [idx] of parts.slice(0, -1).entries()) {
        const dir = parts.slice(0, idx + 1).join("/")
        if (!dir) continue
        out.set(dir, merge(out.get(dir), kind))
      }
    }
    return out
  })

  const empty = (msg: string) => (
    <div class="h-full flex flex-col">
      <div class="h-6 shrink-0" aria-hidden />
      <div class="flex-1 pb-64 flex items-center justify-center text-center">
        <div class="text-12-regular text-text-weak">{msg}</div>
      </div>
    </div>
  )

  const nofiles = createMemo(() => {
    const state = file.tree.state("")
    if (!state?.loaded) return false
    return file.tree.children("").length === 0
  })

  const normalizeTab = (tab: string) => {
    if (!tab.startsWith("file://")) return tab
    return file.tab(tab)
  }

  // FORK: busy→idle 自动刷树用 [feat: file-tree-ux-polish]
  const sync = useSync()
  const openReviewPanel = () => {
    if (!view().reviewPanel.opened()) view().reviewPanel.open()
  }

  // FORK: tabState 上移到 openTab 之前 — openTab 的 toggle 关闭需要 activeFileTab [fix: filetree-toggle] 2026-06-04
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: reviewTab,
    hasReview: props.canReview,
    fileBrowser: () => !!props.fileBrowserState,
  })
  const contextOpen = tabState.contextOpen
  const openFileOpen = tabState.openFileOpen
  const panelTabs = tabState.panelTabs
  const openedTabs = tabState.openedTabs
  const activeTab = tabState.activeTab
  const activeFileTab = tabState.activeFileTab

  const openTab = createOpenSessionFileTab({
    normalizeTab,
    openTab: tabs().open,
    pathFromTab: file.pathFromTab,
    loadFile: file.load,
    openReviewPanel,
    setActive: tabs().setActive,
    // FORK: 再次点击正在查看的文件 → 收起整个查看面板 [fix: filetree-toggle] 2026-06-04
    //   2026-08-11 sync v1.18.4:仅经典布局生效 — v2 双击开永久 tab 会先触发单击 preview 使
    //   目标成为 activeFileTab,toggle 误判「再次点击」把整个面板收掉(上游 file-browser e2e 断言)
    activeFileTab,
    isViewerOpen: () => !settings.general.newLayoutDesigns() && view().reviewPanel.opened(),
    closeViewer: () => view().reviewPanel.close(),
  })

  // FORK-BEGIN: LLM 响应结束(busy→idle)自动递归刷新文件树 [feat: file-tree-ux-polish] 2026-05-04
  createEffect(
    on(
      () => sync().data.session_status[params.id ?? ""]?.type,
      (next, prev) => {
        if (next !== "idle" || prev === undefined || prev === "idle") return
        void file.tree.refreshAll("")
      },
      { defer: true },
    ),
  )
  // FORK-END

  // FORK-BEGIN: 切 tab(包括 .md 内链跳转)→ 文件树 active 高亮 + 自动展开父目录 + 滚动入视野 2026-05-05
  const isWindowsPath = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
  const toFsPath = (p: string) => (isWindowsPath ? p.replaceAll("/", "\\") : p)
  const fsSep = isWindowsPath ? "\\" : "/"

  const activeFilePath = createMemo<string | undefined>(() => {
    const tab = activeFileTab()
    if (!tab) return undefined
    const p = file.pathFromTab(tab)
    if (!p) return undefined
    return toFsPath(p)
  })

  createEffect(() => {
    const p = activeFilePath()
    if (!p) return
    const parts = p.split(fsSep)
    for (let i = 1; i < parts.length; i++) {
      file.tree.expand(parts.slice(0, i).join(fsSep))
    }
    const sel = `[data-tree-path="${CSS.escape(p)}"]`
    let attempts = 0
    const tryScroll = () => {
      const node = document.querySelector(sel)
      if (node instanceof HTMLElement) {
        node.scrollIntoView({ behavior: "smooth", block: "nearest" })
        return
      }
      attempts++
      if (attempts < 30) requestAnimationFrame(tryScroll)
    }
    requestAnimationFrame(tryScroll)
  })
  // FORK-END

  const fileTreeTab = () => layout.fileTree.tab()

  const setFileTreeTabValue = (value: string) => {
    if (value !== "changes" && value !== "all") return
    layout.fileTree.setTab(value)
  }

  const showAllFiles = () => {
    if (fileTreeTab() !== "changes") return
    layout.fileTree.setTab("all")
  }

  let fileFilter: HTMLInputElement | undefined
  let tabList: HTMLDivElement | undefined
  const temporaryTab = tabs().preview

  // FORK-BEGIN: REQ-111 点「正在查看的那个」→ 收起预览器(tab 与文件树两条入口共用)
  //   判定见 session-tab-collapse.ts;临时(preview)tab 要给双击开永久让路,故延后执行、双击时取消。
  //   [feat: session-presentation-input-batch] 2026-08-17
  let activeTabAtPress: string | undefined
  let collapseTimer: ReturnType<typeof setTimeout> | undefined
  const cancelPendingCollapse = () => {
    if (collapseTimer === undefined) return
    clearTimeout(collapseTimer)
    collapseTimer = undefined
  }
  const scheduleCollapse = () => {
    cancelPendingCollapse()
    collapseTimer = setTimeout(() => {
      collapseTimer = undefined
      view().reviewPanel.close()
    }, TAB_COLLAPSE_DEFER_MS)
  }
  onCleanup(cancelPendingCollapse)
  // FORK-END

  const previewTab = (value: string) => {
    const next = normalizeTab(value)
    // FORK: REQ-111 —— 这里**不**做「再次点击收起」。试过:v2 里文件树单击 preview / 双击开永久,
    //   双击的两下都会先经过本函数,任何在此处的提前返回都会打断「双击提升为永久 tab」
    //   (被上游 file-browser-sidebar-tab-switch e2e 当场抓到)。v2 下的收起入口改由顶部 tab 承担,
    //   文件树 hover 提示随之只在它真能用的经典布局显示(见下方 viewerOpen 传参)。
    //   [feat: session-presentation-input-batch] 2026-08-17
    cancelPendingCollapse()
    tabs().previewTab(next)
    const path = file.pathFromTab(next)
    if (path) void file.load(path)
    openReviewPanel()
    queueMicrotask(() => tabs().setActive(next))
  }
  // FORK: REQ-111 —— 双击开永久 tab:先取消顶部 tab 那条待执行的收起,再走原路
  const openPermanentTab = (value: string) => {
    cancelPendingCollapse()
    openTab(value)
  }
  // FORK: REQ-111 —— 文件树「再次点击可收起预览」的 hover 提示,只在该行为**真的可用**时给。
  //   toggle 挂在 createOpenSessionFileTab 的 isViewerOpen 上,而它被限定为经典布局
  //   (v2 双击开永久会先触发单击 preview,toggle 会误判「再次点击」把面板收掉)。
  //   2026-08-11 sync 后 tooltip 照旧全布局弹出 → v2 下「提示在、功能不在」,本批对齐。
  //   [feat: session-presentation-input-batch] 2026-08-17
  const fileTreeCollapseHintOpen = createMemo(
    () => !settings.general.newLayoutDesigns() && view().reviewPanel.opened(),
  )
  const openFileBrowser = () => {
    previewTab(SESSION_OPEN_FILE_TAB)
    queueMicrotask(() => fileFilter?.focus())
  }

  // FORK-BEGIN: REQ-111 顶部 tab 入口(经典与 v2 共用同一套判定,不分叉)
  //   坑:点非激活 tab 时 Kobalte 会先把它切成激活,click 里再读 activeTab 已是新值 → 误收面板。
  //   故按下时先快照。[feat: session-presentation-input-batch] 2026-08-17
  const handleTabPress = (tab: string) => {
    cancelPendingCollapse()
    activeTabAtPress = activeTab()
  }
  const handleTabClick = (tab: string) => {
    const decision = decideTabCollapse({
      tab,
      activeAtPress: activeTabAtPress,
      viewerOpen: view().reviewPanel.opened(),
      isTemporary: temporaryTab() === tab,
      isFileTab: !!file.pathFromTab(normalizeTab(tab)),
    })
    if (decision === "ignore") return
    if (decision === "collapse") {
      view().reviewPanel.close()
      return
    }
    // defer:临时 tab —— 等过双击窗口再收,双击提升永久 tab 时由 handleTabDoubleClick 取消
    scheduleCollapse()
  }
  const handleTabDoubleClick = (tab: string) => {
    cancelPendingCollapse()
    openTab(tab)
  }
  // FORK-END
  const activateTab = (value: string) => {
    const next = normalizeTab(value)
    const path = file.pathFromTab(next)
    if (path) void file.load(path)
    openReviewPanel()
    tabs().setActive(next)
  }
  const browserTab = createMemo(() => {
    if (!props.fileBrowserState) return undefined
    const active = activeTab()
    if (active === SESSION_OPEN_FILE_TAB) return SESSION_OPEN_FILE_TAB
    if (active && file.pathFromTab(active)) return active
    return activeFileTab()
  })
  // Keep the file-browser shell mounted while any file tab exists. Kobalte briefly
  // selects Review while the tab For replaces a preview trigger, which would
  // otherwise dispose the sidebar and reset scroll.
  const fileBrowserMounted = createMemo(() => {
    if (!props.fileBrowserState) return false
    return openedTabs().length > 0 || openFileOpen() || !!browserTab()
  })
  const fileBrowserVisible = createMemo(() => {
    const active = activeTab()
    return active !== "review" && active !== "context" && active !== "empty"
  })
  const openFileKeybind = createMemo(() => command.keybindParts("file.open"))
  const closeTabKeybind = createMemo(() => command.keybindParts("tab.close"))
  const [store, setStore] = createStore({
    activeDraggable: undefined as string | undefined,
  })

  const handleDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    setStore("activeDraggable", id)
  }

  const handleDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const currentTabs = tabs().all()
    const toIndex = getTabReorderIndex(currentTabs, draggable.id.toString(), droppable.id.toString())
    if (toIndex === undefined) return
    tabs().move(draggable.id.toString(), toIndex)
  }

  const handleDragEnd = () => {
    setStore("activeDraggable", undefined)
  }

  createEffect(() => {
    if (!file.ready()) return

    setSessionHandoff(sessionKey(), {
      files: tabs()
        .all()
        .reduce<Record<string, SelectedLineRange | null>>((acc, tab) => {
          const path = file.pathFromTab(tab)
          if (!path) return acc

          const selected = file.selectedLines(path)
          acc[path] =
            selected && typeof selected === "object" && "start" in selected && "end" in selected
              ? (selected as SelectedLineRange)
              : null

          return acc
        }, {}),
    })
  })

  return (
    <Show when={isDesktop() && !(settings.general.newLayoutDesigns() && !params.id)}>
      <aside
        id="review-panel"
        aria-label={language.t("session.panel.reviewAndFiles")}
        aria-hidden={!open()}
        inert={!open()}
        class="relative min-w-0 flex overflow-hidden"
        classList={{
          "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
          "bg-background-base": !settings.general.newLayoutDesigns(),
          "h-full shrink-0": !props.stacked,
          "h-full min-h-0": props.stacked,
          "pointer-events-none": !open(),
          // FORK-BEGIN: REQ-111 恢复「flex-grow 反向驱动」的开/收动画 [feat: titlebar-icons-rearrange]
          //   [feat: session-presentation-input-batch] 2026-08-17
          //   2026-06-13 曾把本面板改为**唯一可伸长项**:宽度完全由聊天区(session.tsx 的
          //   sessionPanelWidth,自带 360ms width 过渡)反向驱动 —— 聊天区收窄查看区就从左向右展开、
          //   聊天区变宽查看区就从右向左收起,与文件树/侧边栏手感一致。2026-08-11 sync 时被回退成
          //   显式 width + transition-[width],正是当年注释里点名的「啪地弹开」的旧做法
          //   (review 态 width 还取 "auto",width 过渡对 auto 根本跑不起来)。
          //   ⚠️ stacked(纵向堆叠)布局主轴是列,flex-grow 会去撑**高度** → 那一档保留显式 width。
          "transition-[flex-grow,flex-basis] duration-[360ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[flex-grow,flex-basis] motion-reduce:transition-none":
            !props.stacked && !props.size.active() && !props.reviewSnap,
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            props.stacked && !props.size.active() && !props.reviewSnap,
          // FORK-END
          "rounded-[10px] shadow-[var(--v2-elevation-raised)] overflow-hidden": settings.general.newLayoutDesigns(),
          "flex-1": reviewOpen(),
          // FORK: 经典布局镜像 —— 本面板排到聊天区左侧。原先靠父容器 `md:flex-row-reverse` 实现,
          //   但两个子项都是固定宽度,总宽超出可用宽度时 row-reverse 会把溢出方向翻到**左侧**,
          //   压进 activity rail 底下把面板左缘内容盖掉(user 2026-08-12 真机反馈)。
          //   改用 order:视觉顺序与 DOM 顺序都不变,溢出方向恢复向右。
          //   [feat: mirror-layout-overflow] 2026-08-12
          "md:order-first": !settings.general.newLayoutDesigns(),
        }}
        // FORK: REQ-111 —— 非 stacked 时不再钉显式 width,改由 flex-grow 0↔1 承担开/收,
        //   实际宽度由聊天区宽度反向决定(见上方 classList 注释)。[feat: session-presentation-input-batch] 2026-08-17
        style={
          props.stacked
            ? { width: panelWidth() }
            : { "flex-grow": open() ? "1" : "0", "flex-basis": "0px" }
        }
      >
        <Show when={open()}>
          <div
            class="size-full flex"
            classList={{
              // FORK: 经典布局把【文件树】排到最左、审查/预览排到它右边(REQ-040 镜像的一部分,
              //   2026-08 上游 merge 冲掉后按 user 2026-08-11 反馈恢复)。
              //   侧面板整体在聊天左侧,故与聊天的分隔线走右缘(border-r)。
              //   v2 维持上游原样。[feat: mirror-layout] 2026-08-11
              //
              // FORK: 2026-08-12 由 flex-row-reverse 改为 order —— 与外层五栏容器同一原因:
              //   本容器子项里【文件树是固定宽度】(w-[240px] 级),审查/预览区 flex-1;
              //   两者总宽超出侧面板宽度时必然溢出,而 row-reverse 会把溢出方向从「右」翻成「左」,
              //   左边正是 activity rail 的地盘 → 文件树左缘内容被盖掉。
              //   [feat: mirror-layout-overflow] [bug-repro: 审查面板与文件树同开时,「所有文件」tab
              //    x 跌到 32(rail 右缘 48)被盖住,文件名开头字符被吃 —— user 2026-08-12 二次截图反馈]
              //
              // FORK: 主区域分隔线(文件树 ↔ 聊天区)改用绝对定位伪元素绘制
              //   [feat: main-divider-visibility] 2026-08-12
              //   [bug-repro: user 两次反馈「文件目录树和聊天区域中间没有分隔的竖线」]
              //
              //   **根因(第二次排查才找到)**:线一直画着,但一直被子元素盖住 ——
              //   本容器是 border-box、宽 240px **含** 1px border,故 content 只有 239px;
              //   而 #file-tree-panel 的宽度是 style 硬值 240px,比父容器 content 宽 1px,
              //   在 overflow:visible 下溢出并**正好覆盖 border 所在的那 1px**。
              //   命中测试实证:elementFromPoint(304, y) 命中的是子元素而非 border。
              //   第一次排查我只看了 computed style(确实是 1px solid),没做像素级确认,
              //   于是误判成「颜色太淡」,把 token 提了一档 —— 治标没治本,user 因此第二次反馈。
              //
              //   改用 after 伪元素:绝对定位、不占布局宽度、不参与 flex 计算,
              //   因此既不会被子元素挤掉,也不会被覆盖。v2 维持上游原样。
              "after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border-base after:z-10":
                !settings.general.newLayoutDesigns(),
              relative: !settings.general.newLayoutDesigns(),
            }}
          >
            <Show when={reviewOpen()}>
              <div
                class="relative min-w-0 h-full flex-1 overflow-hidden"
                classList={{
                  "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
                  "bg-background-base": !settings.general.newLayoutDesigns(),
                  // FORK: 预览区最小宽度兜底 [feat: narrow-window-auto-collapse] 2026-08-12
                  //   [bug-repro: 窄窗口下预览区被挤到约 80px,文字竖排成一列完全不可读]
                  //   主方案是窄窗口自动收起右侧项目侧栏(见 session.tsx);这里再兜一道 ——
                  //   万一还有别的组合把空间挤没,宁可让预览区溢出被裁掉右侧一点,
                  //   也不能压到不可读(user 明确:宽度不够该省略右侧)。
                  //   v2 维持上游原样。
                  "min-w-[320px]": !settings.general.newLayoutDesigns(),
                }}
              >
                <div
                  class="size-full min-w-0 h-full"
                  classList={{
                    "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
                    "bg-background-base": !settings.general.newLayoutDesigns(),
                  }}
                >
                  <Show
                    when={props.fileBrowserState}
                    fallback={
                      <DragDropProvider
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragOver={handleDragOver}
                        collisionDetector={closestCenter}
                      >
                        <DragDropSensors />
                        <ConstrainDragYAxis />
                        <Tabs value={activeTab()} onChange={activateTab}>
                          <div class="sticky top-0 shrink-0 flex">
                            <Tabs.List
                              ref={(el: HTMLDivElement) => {
                                const stop = createFileTabListSync({ el, contextOpen })
                                onCleanup(stop)
                              }}
                            >
                              <Show when={reviewTab() && props.canReview()}>
                                <Tabs.Trigger
                                  value="review"
                                  id={reviewTabID}
                                  aria-controls={activeTab() === "review" ? reviewTabPanelID : undefined}
                                >
                                  <div class="flex items-center gap-1.5">
                                    <div>{language.t("session.tab.review")}</div>
                                    <Show when={props.hasReview()}>
                                      <div>{props.reviewCount()}</div>
                                    </Show>
                                  </div>
                                </Tabs.Trigger>
                              </Show>
                              <Show when={contextOpen()}>
                                <Tabs.Trigger
                                  value="context"
                                  closeButton={
                                    <TooltipKeybind
                                      title={language.t("common.closeTab")}
                                      keybind={command.keybind("tab.close")}
                                      placement="bottom"
                                      gutter={10}
                                    >
                                      <IconButton
                                        icon="close-small"
                                        variant="ghost"
                                        class="h-5 w-5"
                                        onClick={() => tabs().close("context")}
                                        aria-label={language.t("common.closeTab")}
                                      />
                                    </TooltipKeybind>
                                  }
                                  hideCloseButton
                                  onMiddleClick={() => tabs().close("context")}
                                >
                                  <div class="flex items-center gap-2">
                                    <SessionContextUsage variant="indicator" />
                                    <div>{language.t("session.tab.context")}</div>
                                  </div>
                                </Tabs.Trigger>
                              </Show>
                              <SortableProvider ids={openedTabs()}>
                                <For each={panelTabs()}>
                                  {(tab) => (
                                    <Show
                                      when={tab === SESSION_OPEN_FILE_TAB}
                                      fallback={
                                        <SortableTab
                                          tab={tab}
                                          temporary={temporaryTab() === tab}
                                          onTabClose={tabs().close}
                                          onTabDoubleClick={temporaryTab() === tab ? handleTabDoubleClick : undefined}
                                          // FORK: REQ-111 点当前 tab 收起预览器 2026-08-17
                                          onTabPress={handleTabPress}
                                          onTabClick={handleTabClick}
                                          // FORK: 右键「关闭其他标签」[feat: file-tab-close-others] 2026-06-09
                                          //   2026-08-12:上游 merge 冲掉了这个 prop(组件里的菜单项还在,
                                          //   只是没人传 handler → 菜单项整个不渲染),按 user 反馈接回
                                          onCloseOthers={(keep) => closeOtherTabs(openedTabs(), keep, tabs().close)}
                                        />
                                      }
                                    >
                                      <Tabs.Trigger
                                        value={SESSION_OPEN_FILE_TAB}
                                        closeButton={
                                          <TooltipKeybind
                                            title={language.t("common.closeTab")}
                                            keybind={command.keybind("tab.close")}
                                            placement="bottom"
                                            gutter={10}
                                          >
                                            <IconButton
                                              icon="close-small"
                                              variant="ghost"
                                              class="h-5 w-5"
                                              onClick={() => tabs().close(SESSION_OPEN_FILE_TAB)}
                                              aria-label={language.t("common.closeTab")}
                                            />
                                          </TooltipKeybind>
                                        }
                                        hideCloseButton
                                        onMiddleClick={() => tabs().close(SESSION_OPEN_FILE_TAB)}
                                      >
                                        <div class="flex items-center gap-1.5 italic">
                                          <Icon name="open-file" size="small" />
                                          <span>{language.t("command.file.open")}</span>
                                        </div>
                                      </Tabs.Trigger>
                                    </Show>
                                  )}
                                </For>
                              </SortableProvider>
                              <div
                                class="h-full shrink-0 sticky right-0 z-10 flex items-center justify-center pr-3"
                                classList={{
                                  "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
                                  "bg-background-stronger": !settings.general.newLayoutDesigns(),
                                }}
                              >
                                <TooltipKeybind
                                  title={language.t("command.file.open")}
                                  keybind={command.keybind("file.open")}
                                  class="flex items-center"
                                >
                                  <IconButton
                                    icon="plus-small"
                                    variant="ghost"
                                    iconSize="large"
                                    class="!rounded-md"
                                    onClick={() => {
                                      void import("@/components/dialog-select-file").then((x) => {
                                        dialog.show(() => <x.DialogSelectFile mode="files" onOpenFile={showAllFiles} />)
                                      })
                                    }}
                                    aria-label={language.t("command.file.open")}
                                  />
                                </TooltipKeybind>
                              </div>
                            </Tabs.List>
                          </div>

                          <Show when={reviewTab() && props.canReview() && activeTab() === "review"}>
                            <div
                              id={reviewTabPanelID}
                              role="tabpanel"
                              aria-labelledby={reviewTabID}
                              tabIndex={props.reviewHasFocusableContent() ? undefined : 0}
                              data-slot="tabs-content"
                              class="flex flex-col h-full overflow-hidden contain-strict"
                            >
                              {props.reviewPanel()}
                            </div>
                          </Show>

                          <Show when={activeTab() === "empty"}>
                            <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                              <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                                <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                                  <Mark class="w-14 opacity-10" />
                                  <div class="text-14-regular text-text-weak max-w-56">
                                    {language.t("session.files.selectToOpen")}
                                  </div>
                                </div>
                              </div>
                            </Tabs.Content>
                          </Show>

                          <Show when={activeTab() === "context"}>
                            <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                              <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                                <SessionContextTab />
                              </div>
                            </Tabs.Content>
                          </Show>

                          <Show when={activeFileTab()} keyed>
                            {/* FORK: 接通 openTab 让 .md 内链点击在查看器打开 2026-05-05 */}
                            {(tab) => <FileTabContent tab={tab} onOpenTab={(path) => openTab(file.tab(path))} />}
                          </Show>
                        </Tabs>
                        <DragOverlay>
                          <Show when={store.activeDraggable} keyed>
                            {(tab) => {
                              const path = file.pathFromTab(tab)
                              return (
                                <div data-component="tabs-drag-preview">
                                  <Show when={path}>
                                    {(p) => <FileVisual active path={p()} temporary={temporaryTab() === tab} />}
                                  </Show>
                                </div>
                              )
                            }}
                          </Show>
                        </DragOverlay>
                      </DragDropProvider>
                    }
                  >
                    <DndKitProvider
                      sensors={[
                        PointerSensor.configure({
                          activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
                          preventActivation: (event) =>
                            event.target instanceof Element &&
                            (!!event.target.closest('[data-slot="tabs-trigger-close-button"]') ||
                              !!event.target.closest(".session-review-v2-open-in-app-slot")),
                        }),
                      ]}
                      modifiers={[
                        RestrictToHorizontalAxis,
                        RestrictToElement.configure({ element: () => tabList ?? null }),
                      ]}
                      plugins={(defaults) => [
                        ...defaults.filter((plugin) => plugin !== Accessibility),
                        AutoScroller.configure({ acceleration: 8, threshold: { x: 0.05, y: 0 } }),
                        Feedback.configure({ dropAnimation: null }),
                      ]}
                      onDragEnd={(event) => {
                        const source = event.operation.source
                        if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
                        tabs().move(source.id.toString(), source.index)
                      }}
                    >
                      <Tabs value={activeTab()} onChange={activateTab}>
                        <div class="session-review-v2-tabs-bar sticky top-0 shrink-0 flex items-center">
                          <Tabs.List
                            ref={(el: HTMLDivElement) => {
                              tabList = el
                              const stop = createFileTabListSync({ el, contextOpen })
                              onCleanup(stop)
                            }}
                          >
                            <Show when={props.reviewSidebarToggle}>
                              {(toggle) => (
                                <div class="session-review-v2-sidebar-toggle-slot h-full shrink-0 sticky left-0 z-10 flex items-center justify-center bg-v2-background-bg-base">
                                  {toggle()(activeTab() === SESSION_OPEN_FILE_TAB)}
                                </div>
                              )}
                            </Show>
                            <Show when={reviewTab() && props.canReview()}>
                              <Tabs.Trigger
                                value="review"
                                id={reviewTabID}
                                aria-controls={activeTab() === "review" ? reviewTabPanelID : undefined}
                              >
                                {props.hasReview()
                                  ? language.t("session.review.filesChanged", { count: props.reviewCount() })
                                  : language.t("session.tab.review")}
                              </Tabs.Trigger>
                            </Show>
                            <Show when={contextOpen()}>
                              <Tabs.Trigger
                                value="context"
                                closeButton={
                                  <TooltipV2
                                    value={
                                      <>
                                        {language.t("common.closeTab")}
                                        <Show when={closeTabKeybind().length > 0}>
                                          <KeybindV2 keys={closeTabKeybind()} variant="neutral" />
                                        </Show>
                                      </>
                                    }
                                    placement="bottom"
                                    gutter={10}
                                  >
                                    <IconButton
                                      icon="close-small"
                                      variant="ghost"
                                      class="h-5 w-5"
                                      onClick={() => tabs().close("context")}
                                      aria-label={language.t("common.closeTab")}
                                    />
                                  </TooltipV2>
                                }
                                hideCloseButton
                                onMiddleClick={() => tabs().close("context")}
                              >
                                <div class="flex items-center gap-2">
                                  <SessionContextUsage variant="indicator" />
                                  <div>{language.t("session.tab.context")}</div>
                                </div>
                              </Tabs.Trigger>
                            </Show>
                            <For each={panelTabs()}>
                              {(tab) => (
                                <Show
                                  when={tab === SESSION_OPEN_FILE_TAB}
                                  fallback={
                                    <SortableTabV2
                                      tab={tab}
                                      index={() => tabs().all().indexOf(tab)}
                                      temporary={temporaryTab() === tab}
                                      onTabClose={tabs().close}
                                      onTabDoubleClick={temporaryTab() === tab ? handleTabDoubleClick : undefined}
                                      // FORK: REQ-111 点当前 tab 收起预览器 2026-08-17
                                      onTabPress={handleTabPress}
                                      onTabClick={handleTabClick}
                                    />
                                  }
                                >
                                  <Tabs.Trigger
                                    value={SESSION_OPEN_FILE_TAB}
                                    closeButton={
                                      <TooltipV2
                                        value={
                                          <>
                                            {language.t("common.closeTab")}
                                            <Show when={closeTabKeybind().length > 0}>
                                              <KeybindV2 keys={closeTabKeybind()} variant="neutral" />
                                            </Show>
                                          </>
                                        }
                                        placement="bottom"
                                        gutter={10}
                                      >
                                        <IconButton
                                          icon="close-small"
                                          variant="ghost"
                                          class="h-5 w-5"
                                          onClick={() => tabs().close(SESSION_OPEN_FILE_TAB)}
                                          aria-label={language.t("common.closeTab")}
                                        />
                                      </TooltipV2>
                                    }
                                    hideCloseButton
                                    onMiddleClick={() => tabs().close(SESSION_OPEN_FILE_TAB)}
                                  >
                                    <div class="flex items-center gap-1.5 italic">
                                      <Icon name="open-file" size="small" />
                                      <span>{language.t("command.file.open")}</span>
                                    </div>
                                  </Tabs.Trigger>
                                </Show>
                              )}
                            </For>
                            <div
                              class="h-full shrink-0 sticky right-0 z-10 flex items-center justify-center"
                              classList={{
                                "bg-v2-background-bg-base": settings.general.newLayoutDesigns(),
                                "bg-background-stronger": !settings.general.newLayoutDesigns(),
                              }}
                            >
                              <TooltipV2
                                value={
                                  <>
                                    {language.t("command.file.open")}
                                    <Show when={openFileKeybind().length > 0}>
                                      <KeybindV2 keys={openFileKeybind()} variant="neutral" />
                                    </Show>
                                  </>
                                }
                                placement="bottom"
                                class="flex items-center"
                              >
                                <IconButtonV2
                                  icon={<Icon name="plus-small" />}
                                  variant="ghost-muted"
                                  size="large"
                                  onClick={() => openFileBrowser()}
                                  aria-label={language.t("command.file.open")}
                                />
                              </TooltipV2>
                            </div>
                          </Tabs.List>
                          <div
                            class="session-review-v2-open-in-app-slot shrink-0 flex items-center pr-3"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <OpenInAppV2 directory={projectDirectory} />
                          </div>
                        </div>

                        <Show when={reviewTab() && props.canReview() && activeTab() === "review"}>
                          <div
                            id={reviewTabPanelID}
                            role="tabpanel"
                            aria-labelledby={reviewTabID}
                            tabIndex={props.reviewHasFocusableContent() ? undefined : 0}
                            data-slot="tabs-content"
                            class="flex flex-col h-full overflow-hidden contain-strict"
                          >
                            {props.reviewPanel()}
                          </div>
                        </Show>

                        <Show when={activeTab() === "empty"}>
                          <Tabs.Content value="empty" class="flex flex-col h-full overflow-hidden contain-strict">
                            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                              <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-6">
                                <Mark class="w-14 opacity-10" />
                                <div class="text-14-regular text-text-weak max-w-56">
                                  {language.t("session.files.selectToOpen")}
                                </div>
                              </div>
                            </div>
                          </Tabs.Content>
                        </Show>

                        <Show when={activeTab() === "context"}>
                          <Tabs.Content value="context" class="flex flex-col h-full overflow-hidden contain-strict">
                            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
                              <SessionContextTab />
                            </div>
                          </Tabs.Content>
                        </Show>

                        <Show when={fileBrowserMounted()}>
                          <div
                            id={fileBrowserTabPanelID}
                            role="tabpanel"
                            data-slot="tabs-content"
                            class="h-full min-h-0 overflow-hidden"
                            classList={{ hidden: !fileBrowserVisible() }}
                            inert={!fileBrowserVisible() || undefined}
                          >
                            <SessionFileBrowserTab
                              tab={browserTab() ?? activeFileTab() ?? SESSION_OPEN_FILE_TAB}
                              placeholder={
                                (browserTab() ?? activeFileTab() ?? SESSION_OPEN_FILE_TAB) === SESSION_OPEN_FILE_TAB
                              }
                              active={file.pathFromTab(browserTab() ?? activeFileTab() ?? "")}
                              kinds={kinds()}
                              state={props.fileBrowserState!}
                              onSelect={(path) => previewTab(file.tab(path))}
                              /* FORK: REQ-111 双击开永久 tab 时取消顶部 tab 那条待执行的收起 2026-08-17 */
                              onSelectPermanent={(path) => openPermanentTab(file.tab(path))}
                              filterRef={(element) => (fileFilter = element)}
                            />
                          </div>
                        </Show>
                      </Tabs>
                    </DndKitProvider>
                  </Show>
                </div>
              </div>
            </Show>

            <Show when={fileOpen()}>
              <div
                id="file-tree-panel"
                class="relative min-w-0 h-full shrink-0 overflow-hidden"
                classList={{
                  "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                    !props.size.active(),
                  // FORK: 经典布局镜像 —— 文件树排到审查/预览区左边。原先靠父容器 flex-row-reverse,
                  //   但那会把「空间不足」时的溢出方向翻到左侧、压进 activity rail。改用 order:
                  //   视觉顺序与 DOM 顺序都不变,溢出方向恢复向右。
                  //   [feat: mirror-layout-overflow] 2026-08-12
                  "order-first": !settings.general.newLayoutDesigns(),
                }}
                style={{ width: treeWidth() }}
              >
                <div
                  class="h-full flex flex-col overflow-hidden group/filetree"
                  classList={{
                    // FORK: 经典布局文件树在左 → 与右侧审查的分隔线走右缘;v2 维持上游左缘
                    // [feat: mirror-layout] 2026-08-11
                    "border-r border-border-weaker-base": reviewOpen() && !settings.general.newLayoutDesigns(),
                    "border-l border-border-weaker-base": reviewOpen() && settings.general.newLayoutDesigns(),
                  }}
                >
                  <Tabs
                    variant="pill"
                    value={fileTreeTab()}
                    onChange={setFileTreeTabValue}
                    class="h-full"
                    data-scope="filetree"
                  >
                    <Tabs.List
                      classList={{
                        // FORK: 经典布局把 [所有文件] 排到左、[N 更改] 排到右
                        //   (REQ-041 的文件树 tab 顺序对调,2026-08 上游 merge 冲掉后按 user 反馈恢复)。
                        //   只翻视觉不改 DOM 顺序 —— 上游若增删 tab 仍能正常 merge。
                        //   v2 维持上游原样。[feat: iconbar-left-decouple] 2026-08-11
                        //
                        // FORK: 2026-08-12 由 flex-row-reverse 改为给子项 order —— 同一类缺陷:
                        //   tab 文字放不下时 row-reverse 会把溢出翻到左侧,「所有文件」开头的字被切掉
                        //   (user 二次截图里显示成「有文件」)。改 order 后溢出恢复向右。
                        //   [feat: mirror-layout-overflow]
                      }}
                    >
                      <Tabs.Trigger
                        value="changes"
                        class="flex-1"
                        classes={{ button: "w-full" }}
                        classList={{
                          // FORK: 经典布局下 [N 更改] 排到右 [feat: mirror-layout-overflow] 2026-08-12
                          "order-last": !settings.general.newLayoutDesigns(),
                        }}
                      >
                        <Show
                          when={settings.general.newLayoutDesigns()}
                          fallback={
                            <>
                              {props.reviewCount()}{" "}
                              {language.t(
                                props.reviewCount() === 1 ? "session.review.change.one" : "session.review.change.other",
                              )}
                            </>
                          }
                        >
                          {language.t("session.review.filesChanged", { count: props.reviewCount() })}
                        </Show>
                      </Tabs.Trigger>
                      <Tabs.Trigger value="all" class="flex-1" classes={{ button: "w-full" }}>
                        {language.t("session.files.all")}
                      </Tabs.Trigger>
                    </Tabs.List>
                    <Show when={fileTreeTab() === "changes"}>
                      <Tabs.Content value="changes" class="bg-background-stronger px-3 py-0">
                        <Switch>
                          <Match when={props.hasReview() || !props.diffsReady()}>
                            <Show
                              when={props.diffsReady()}
                              fallback={
                                <div class="px-2 py-2 text-12-regular text-text-weak">
                                  {language.t("common.loading")}
                                  {language.t("common.loading.ellipsis")}
                                </div>
                              }
                            >
                              <FileTree
                                path=""
                                class="pt-3"
                                allowed={diffFiles()}
                                kinds={kinds()}
                                draggable={false}
                                active={props.activeDiff}
                                onFileClick={(node) => props.focusReviewDiff(node.path)}
                              />
                            </Show>
                          </Match>
                        </Switch>
                      </Tabs.Content>
                    </Show>
                    <Show when={fileTreeTab() === "all"}>
                      <Tabs.Content value="all" class="bg-background-stronger px-3 py-0">
                        <Switch>
                          <Match when={nofiles()}>{empty(language.t("session.files.empty"))}</Match>
                          <Match when={true}>
                            <FileTree
                              path=""
                              class="pt-3"
                              modified={diffFiles()}
                              kinds={kinds()}
                              // FORK: 文件树里「当前正在看的那个文件」高亮 [feat: file-tree-ux-polish]
                              active={activeFilePath()}
                              // FORK: 预览区已开时,给「正在查看的那一行」加收起 hover tooltip(与 toggle 条件一致)
                              //   [feat: filetree-hover-collapse-hint] 2026-06-09
                              //   2026-08-12:两个 prop 都在上游 merge 中被冲掉(组件仍支持,只是没人传)
                              //   2026-08-17 REQ-111:改用 fileTreeCollapseHintOpen —— 只在 toggle 真能用的
                              //   经典布局给提示,不让 v2 下出现「提示在、功能不在」
                              viewerOpen={fileTreeCollapseHintOpen()}
                              onFileClick={(node) => openTab(file.tab(node.path))}
                            />
                          </Match>
                        </Switch>
                      </Tabs.Content>
                    </Show>
                  </Tabs>
                </div>
                <Show when={fileOpen()}>
                  <div onPointerDown={() => props.size.start()}>
                    <ResizeHandle
                      direction="horizontal"
                      // FORK: 经典布局文件树靠左 → 拖拽手柄锚右边界;v2 维持上游 start
                      // [feat: mirror-layout] 2026-08-11
                      edge={settings.general.newLayoutDesigns() ? "start" : "end"}
                      size={fileTreeWidth()}
                      min={FILE_TREE_WIDTH_MIN}
                      max={480}
                      onResize={(width) => {
                        props.size.touch()
                        layout.fileTree.resize(width)
                      }}
                    />
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </aside>
    </Show>
  )
}
