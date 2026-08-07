// FORK-ONLY file: REQ-097 会话内查找条 [feat: in-session-find]
//
// - ⌘F 按焦点作用域分发:带 data-deskfox-find-ignore 祖先(文件预览区)的焦点不响应,
//   预留该属性即为将来预览区自建查找的注册口(user 拍板的作用域架构)。
// - 匹配/计数在数据层(全部已加载消息),高亮在 DOM 层(CSS Custom Highlight,只染已渲染部分)。
// - Enter/⇧Enter(或 ↑↓ 按钮)在出现间环形跳转:先 revealMessage 滚到轮次,再定位轮内 Range。

import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { buildOccurrences, indexForAnchor, stepIndex, type TurnText } from "./find-core"
import {
  applyHighlights,
  clearHighlights,
  collectRanges,
  FIND_HIGHLIGHT,
  FIND_HIGHLIGHT_ACTIVE,
  highlightSupported,
  locateActiveRange,
} from "./dom-highlight"
import { consumePendingFind } from "./find-request"

const FIND_STYLE = `
::highlight(${FIND_HIGHLIGHT}) { background-color: color-mix(in srgb, var(--surface-warning-strong, #f5c518) 45%, transparent); }
::highlight(${FIND_HIGHLIGHT_ACTIVE}) { background-color: color-mix(in srgb, var(--surface-warning-strong, #f5a518) 90%, transparent); color: var(--text-strong, inherit); }
`

export function SessionFindBar(props: {
  sessionID: Accessor<string | undefined>
  turns: Accessor<TurnText[]>
  revealMessage: (id: string) => void
  scroller: () => HTMLElement | undefined
}) {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(-1)
  let inputRef: HTMLInputElement | undefined
  let frames: number[] = []

  const occurrences = createMemo(() => buildOccurrences(props.turns(), query().trim()))
  const total = () => occurrences().length

  const queue = (fn: () => void) => {
    const id = requestAnimationFrame(() => {
      frames = frames.filter((f) => f !== id)
      fn()
    })
    frames.push(id)
  }
  const cancelFrames = () => {
    for (const id of frames) cancelAnimationFrame(id)
    frames = []
  }

  const refreshHighlights = () => {
    const root = props.scroller()
    if (!root || !open() || !query().trim() || !highlightSupported()) {
      clearHighlights()
      return
    }
    const ranges = collectRanges(root, query().trim())
    const current = occurrences()[active()]
    const activeRange = current ? locateActiveRange(root, ranges, current.anchorID, current.localIndex) : undefined
    applyHighlights(ranges, activeRange)
    return activeRange
  }

  /** 跳到第 index 个出现:滚动到轮次 → 渲染后定位轮内 Range → 滚入视口 */
  const jumpTo = (index: number, attempts = 8) => {
    const current = occurrences()[index]
    if (!current) return
    setActive(index)
    props.revealMessage(current.anchorID)
    const tryLocate = (left: number) => {
      const activeRange = refreshHighlights()
      if (activeRange) {
        const rect = activeRange.getBoundingClientRect()
        const root = props.scroller()
        if (root) {
          const rootRect = root.getBoundingClientRect()
          if (rect.top < rootRect.top + 60 || rect.bottom > rootRect.bottom - 20) {
            root.scrollTop += rect.top - rootRect.top - rootRect.height / 2
            queue(() => refreshHighlights())
          }
        }
        return
      }
      if (left > 0) queue(() => tryLocate(left - 1))
    }
    queue(() => tryLocate(attempts))
  }

  const step = (direction: 1 | -1) => {
    const next = stepIndex(active(), total(), direction)
    if (next === -1) return
    jumpTo(next)
  }

  const openBar = (initialQuery?: string, anchorID?: string) => {
    batch(() => {
      setOpen(true)
      if (initialQuery !== undefined) setQuery(initialQuery)
    })
    queue(() => {
      inputRef?.focus()
      inputRef?.select()
      if (initialQuery !== undefined && initialQuery.trim()) {
        const index = indexForAnchor(buildOccurrences(props.turns(), initialQuery.trim()), anchorID)
        if (index >= 0) jumpTo(index)
      }
    })
  }

  const close = () => {
    cancelFrames()
    setOpen(false)
    setActive(-1)
    clearHighlights()
  }

  const onWindowKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase()
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === "f") {
      const target = event.target as HTMLElement | null
      // 焦点作用域:文件预览区(data-deskfox-find-ignore)不接管,留给将来的预览区查找
      if (target?.closest?.("[data-deskfox-find-ignore]")) return
      // capture 期截停:焦点在 composer(CodeMirror 自带 Mod-F 搜索面板)时也要由会话查找接管
      event.preventDefault()
      event.stopPropagation()
      openBar()
      return
    }
    if (event.key === "Escape" && open()) {
      const target = event.target as HTMLElement | null
      if (target && (target === inputRef || target.closest?.("[data-deskfox-find-bar]"))) {
        event.preventDefault()
        close()
      }
    }
  }

  onMount(() => {
    // capture:true — 先于 CodeMirror 等组件级 keydown(它们在冒泡期 stopPropagation)
    window.addEventListener("keydown", onWindowKeyDown, { capture: true })
  })
  onCleanup(() => {
    window.removeEventListener("keydown", onWindowKeyDown, { capture: true })
    cancelFrames()
    clearHighlights()
  })

  // ⌘K 内容命中联动:进入会话后带词开条并定位
  createEffect(
    on(
      () => [props.sessionID(), props.turns().length] as const,
      () => {
        const request = consumePendingFind(props.sessionID())
        if (!request) return
        openBar(request.query, request.anchorID)
      },
    ),
  )

  // 查询/数据变化时刷新高亮;查询变化重置游标到首个出现
  createEffect(
    on(
      () => [query(), open(), props.turns()] as const,
      (_, prev) => {
        if (!open()) return
        if (prev && prev[0] !== query()) {
          const index = total() > 0 ? 0 : -1
          setActive(index)
          if (index === 0) {
            jumpTo(0)
            return
          }
        }
        queue(() => refreshHighlights())
      },
      { defer: true },
    ),
  )

  // 滚动时补染新渲染进来的行(虚拟化)
  createEffect(() => {
    const root = props.scroller()
    if (!root || !open()) return
    let throttle: number | undefined
    const onScroll = () => {
      if (throttle !== undefined) return
      throttle = window.setTimeout(() => {
        throttle = undefined
        refreshHighlights()
      }, 120)
    }
    root.addEventListener("scroll", onScroll, { passive: true })
    onCleanup(() => {
      root.removeEventListener("scroll", onScroll)
      if (throttle !== undefined) window.clearTimeout(throttle)
    })
  })

  // 切换会话时关条
  createEffect(
    on(
      () => props.sessionID(),
      (_, prev) => {
        if (prev !== undefined) close()
      },
      { defer: true },
    ),
  )

  return (
    <>
      <style>{FIND_STYLE}</style>
      <Show when={open()}>
        <div
          data-deskfox-find-bar
          class="absolute top-2 right-4 z-40 flex items-center gap-1 rounded-lg border border-border-weak-base bg-surface-raised-stronger-non-alpha shadow-md pl-2 pr-1 py-1"
        >
          <Icon name="magnifying-glass" size="small" class="shrink-0 text-icon-weak" />
          <InlineInput
            ref={(el) => {
              inputRef = el
            }}
            value={query()}
            placeholder={language.t("find.placeholder")}
            class="w-44 text-13-regular text-text-strong"
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === "Enter") {
                event.preventDefault()
                if (active() === -1) {
                  if (total() > 0) jumpTo(0)
                  return
                }
                step(event.shiftKey ? -1 : 1)
                return
              }
              if (event.key === "Escape") {
                event.preventDefault()
                close()
              }
            }}
          />
          <span class="text-12-regular text-text-weak whitespace-nowrap min-w-8 text-center" data-find-count>
            {total() > 0 ? `${Math.max(active(), 0) + 1}/${total()}` : "0/0"}
          </span>
          <IconButton
            icon="arrow-up"
            variant="ghost"
            class="size-6 rounded-md"
            aria-label={language.t("find.prev")}
            disabled={total() === 0}
            onClick={() => step(-1)}
          />
          <IconButton
            icon="arrow-up"
            variant="ghost"
            class="size-6 rounded-md rotate-180"
            aria-label={language.t("find.next")}
            disabled={total() === 0}
            onClick={() => step(1)}
          />
          <IconButton
            icon="close-small"
            variant="ghost"
            class="size-6 rounded-md"
            aria-label={language.t("common.close")}
            onClick={close}
          />
        </div>
      </Show>
    </>
  )
}
