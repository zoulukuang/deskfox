// FORK-ONLY file: REQ-097 会话内查找条 [feat: in-session-find]
//
// - ⌘F 按焦点作用域分发:带 data-deskfox-find-ignore 祖先(文件预览区)的焦点不响应,
//   预留该属性即为将来预览区自建查找的注册口(user 拍板的作用域架构)。
// - 匹配/计数在数据层(全部已加载消息),高亮在 DOM 层(CSS Custom Highlight,只染已渲染部分)。
// - Enter/⇧Enter(或 ↑↓ 按钮)在出现间环形跳转:先 revealMessage 滚到轮次,再定位轮内 Range。

import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { InlineInput } from "@opencode-ai/ui/inline-input"
import { useLocation, useNavigate } from "@solidjs/router"
import { batch, createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { useLanguage } from "@/context/language"
import { buildOccurrences, indexForAnchor, stepIndex, type Occurrence, type TurnUnit } from "./find-core"
import {
  applyHighlights,
  clearHighlights,
  collectRanges,
  FIND_HIGHLIGHT,
  FIND_HIGHLIGHT_ACTIVE,
  highlightSupported,
  locateRangeInUnit,
} from "./dom-highlight"
import { consumePendingFind, setPendingFind, type FindRequest } from "./find-request"

const FIND_STYLE = `
::highlight(${FIND_HIGHLIGHT}) { background-color: color-mix(in srgb, var(--surface-warning-strong, #f5c518) 45%, transparent); }
::highlight(${FIND_HIGHLIGHT_ACTIVE}) { background-color: color-mix(in srgb, var(--surface-warning-strong, #f5a518) 90%, transparent); color: var(--text-strong, inherit); }
`

export function SessionFindBar(props: {
  sessionID: Accessor<string | undefined>
  units: Accessor<TurnUnit[]>
  /** 直达出现所在行(scrollToIndex);行尚未构建(深位历史)返回 false */
  reveal: (occurrence: Occurrence) => boolean
  scroller: () => HTMLElement | undefined
  /** V2:历史分页 —— 查找开着时后台渐进加载更早历史,总数收敛,深位命中可遍历 */
  history: { more: () => boolean; loading: () => boolean; loadMore: () => Promise<void> }
}) {
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(-1)
  // ⌘K 联动的目标锚点可能落在尚未加载进 store 的深位历史,turns 增长时再升级定位
  const [pendingAnchor, setPendingAnchor] = createSignal<string | undefined>(undefined)
  let inputRef: HTMLInputElement | undefined
  let frames: number[] = []

  const occurrences = createMemo(() => buildOccurrences(props.units(), query().trim()))
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
    const activeRange = current ? locateRangeInUnit(root, query().trim(), current) : undefined
    applyHighlights(ranges, activeRange)
    return activeRange
  }

  /** 跳到第 index 个出现:**locate-first** —— 行已在 DOM(含同行多命中场景)直接行内定位 +
   *  视口微调;行未渲染才 reveal(scrollToIndex 直达行),行未构建(深位历史)再 hash 兜底翻页。
   *  顺序不可倒:reveal 的 scrollToIndex 异步落地会把随后的关键词微调吸回行中心(真机竞态实证)。 */
  const jumpTo = (index: number, attempts = 240) => {
    const current = occurrences()[index]
    if (!current) return
    setActive(index)
    activeKey = occurrenceKey(current)
    let revealed = false
    let hashed = false
    const tryLocate = (left: number) => {
      if (!open() || active() !== index || left <= 0) return
      const activeRange = refreshHighlights()
      if (activeRange) {
        const rect = activeRange.getBoundingClientRect()
        const root = props.scroller()
        if (root) {
          const rootRect = root.getBoundingClientRect()
          const outOfView = rect.top < rootRect.top + 60 || rect.bottom > rootRect.bottom - 20
          if (outOfView) {
            const delta = rect.top - rootRect.top - rootRect.height / 2
            // 大距离交给 virtua scrollToIndex(自带高度估算收敛;直接 scrollTop 大步会被
            // 估算 scrollHeight 钳住,真机实证偏差恰为一个视口高)
            if (Math.abs(delta) > rootRect.height && !revealed) {
              revealed = props.reveal(current)
            } else {
              root.scrollTop += delta
            }
            // 收敛复核:虚拟布局随滚动重估,继续校正直到落进视口
            queue(() => tryLocate(left - 1))
            return
          }
        }
        return
      }
      // 行不在 DOM:滚到该行;行都还没构建(深位历史):hash 触发自动翻页加载
      if (!revealed) {
        revealed = props.reveal(current)
        if (!revealed && !hashed) {
          hashed = true
          const targetHash = `#message-${current.anchorID}`
          if (location.hash !== targetHash) {
            navigate(location.pathname + location.search + targetHash, { replace: true })
          }
        }
      }
      queue(() => tryLocate(left - 1))
    }
    queue(() => tryLocate(attempts))
  }

  // ---- V2:深位历史渐进加载 ----
  // 查找开着时后台逐页拉更早历史(节流),总数收敛;封顶防巨型会话拉爆
  const MAX_AUTO_PAGES = 40
  let autoPages = 0
  let autoTimer: number | undefined
  const scheduleDeepLoad = () => {
    if (autoTimer !== undefined) return
    if (!open() || !query().trim()) return
    if (autoPages >= MAX_AUTO_PAGES || !props.history.more() || props.history.loading()) return
    autoTimer = window.setTimeout(() => {
      autoTimer = undefined
      if (!open() || !query().trim() || autoPages >= MAX_AUTO_PAGES) return
      autoPages += 1
      void props.history.loadMore().finally(() => scheduleDeepLoad())
    }, 250)
  }
  const cancelDeepLoad = () => {
    if (autoTimer !== undefined) window.clearTimeout(autoTimer)
    autoTimer = undefined
  }
  createEffect(() => {
    if (open() && query().trim()) scheduleDeepLoad()
    else cancelDeepLoad()
  })
  onCleanup(cancelDeepLoad)

  // 历史前插会让既有出现的 index 后移:按身份(unitID+indexInUnit)追踪并对齐游标;
  // 深挖后从 0 → 有命中时自动定位到首个(pendingAnchor 联动在途时让位)
  const occurrenceKey = (occurrence: Occurrence) => `${occurrence.unitID}:${occurrence.indexInUnit}`
  let activeKey: string | undefined
  createEffect(
    on(occurrences, (list) => {
      if (open() && active() === -1 && list.length > 0 && !pendingAnchor()) {
        jumpTo(0)
        return
      }
      if (!activeKey || active() < 0) return
      const currentAt = list[active()]
      if (currentAt && occurrenceKey(currentAt) === activeKey) return
      const realigned = list.findIndex((occurrence) => occurrenceKey(occurrence) === activeKey)
      if (realigned >= 0) setActive(realigned)
    }),
  )

  const step = (direction: 1 | -1) => {
    setPendingAnchor(undefined)
    // ⇧Enter 到达最早已加载出现时,若还有更早历史:先拉一批再步进(最多 5 页/次)
    if (direction === -1 && active() === 0 && props.history.more()) {
      void (async () => {
        const before = occurrences().length
        for (let i = 0; i < 5 && props.history.more(); i++) {
          await props.history.loadMore()
          if (occurrences().length > before) break
        }
        const grown = occurrences().length - before
        if (grown > 0) jumpTo(grown - 1)
        else if (total() > 0) jumpTo(stepIndex(0, total(), -1))
      })()
      return
    }
    const next = stepIndex(active(), total(), direction)
    if (next === -1) return
    jumpTo(next)
  }

  const openBar = (initialQuery?: string, anchorID?: string) => {
    autoPages = 0
    batch(() => {
      setOpen(true)
      if (initialQuery !== undefined) setQuery(initialQuery)
    })
    queue(() => {
      inputRef?.focus()
      inputRef?.select()
      if (initialQuery !== undefined && initialQuery.trim()) {
        const built = buildOccurrences(props.units(), initialQuery.trim())
        const hasAnchor = !!anchorID && built.some((occurrence) => occurrence.anchorID === anchorID)
        if (anchorID && !hasAnchor) {
          // 目标轮次还没进 store(深位历史):先靠 hash 机制翻页加载,turns 增长后升级定位
          setPendingAnchor(anchorID)
          const targetHash = `#message-${anchorID}`
          if (location.hash !== targetHash) navigate(location.pathname + location.search + targetHash, { replace: true })
          return
        }
        const index = indexForAnchor(built, anchorID)
        if (index >= 0) jumpTo(index)
      }
    })
  }

  // pendingAnchor 升级:深位历史加载进来后定位到目标轮次的首个出现
  createEffect(
    on(
      () => [props.units(), occurrences()] as const,
      () => {
        const anchor = pendingAnchor()
        if (!anchor || !open()) return
        const index = occurrences().findIndex((occurrence) => occurrence.anchorID === anchor)
        if (index === -1) return
        setPendingAnchor(undefined)
        jumpTo(index)
      },
      { defer: true },
    ),
  )

  const close = () => {
    cancelFrames()
    cancelDeepLoad()
    activeKey = undefined
    setOpen(false)
    setActive(-1)
    setPendingAnchor(undefined)
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

  // ⌘K 内容命中联动:进入会话后带词开条并定位。
  // 依赖含 location.hash:目标就是当前会话时 sessionID/units 都不变,靠 hash 变化触发消费
  // ⚠️ 垂死实例回投:同会话 #message- hash 导航会让 timeline(连同本组件)重挂 —— 旧实例
  //   消费请求、开条,~200ms 后随重挂被卸载,查找条陪葬且纸条已被吃掉,新实例两手空空
  //   (真机实锤 2026-08-07;mock e2e 数据即取即得不重挂,测不出)。消费即登记,卸载发生
  //   在消费后 2s 内则回投,新实例挂载时重新领取;陈腐防线在 find-request 的 TTL。
  let consumedLink: { request: FindRequest; at: number } | undefined
  createEffect(
    on(
      () => [props.sessionID(), props.units().length, location.hash] as const,
      () => {
        const request = consumePendingFind(props.sessionID())
        if (!request) return
        consumedLink = { request, at: Date.now() }
        openBar(request.query, request.anchorID)
      },
    ),
  )
  onCleanup(() => {
    if (consumedLink && Date.now() - consumedLink.at < 2000) setPendingFind(consumedLink.request)
  })

  // 查询/数据变化时刷新高亮;查询变化重置游标到首个出现
  createEffect(
    on(
      () => [query(), open(), props.units()] as const,
      (_, prev) => {
        if (!open()) return
        if (prev && prev[0] !== query()) {
          setPendingAnchor(undefined)
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
            {/* V2:更早历史仍在加载/存在时挂 "+",总数随深挖收敛 */}
            {total() > 0
              ? `${Math.max(active(), 0) + 1}/${total()}${props.history.more() ? "+" : ""}`
              : props.history.more() || props.history.loading()
                ? "0/0+"
                : "0/0"}
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
