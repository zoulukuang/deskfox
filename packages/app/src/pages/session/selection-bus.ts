// FORK: 选区历史 — 单例文档级 bus(消除 N×FileTabContent listener)2026-05-29
//
// 老 pattern:每个 `FileTabContent` 实例自己挂 `document.addEventListener("selectionchange", ...)`,
// N 个 tab = N 个 listener,每次 selectionchange 浏览器要遍历所有 listener。
// 各 listener 都做"是不是本 viewer 的选区"判断,所以 N×listener × per-event scope check 全是 cost。
//
// 新 pattern:整 app 一个 document.selectionchange listener,持有 `Set<ViewerRegistration>`,
// 每次事件:遍历 registrations,first-match-wins 路由到对应 viewer 的 history。
// 0 个 viewer 注册时自动 detach listener,减少冷启动开销。
//
// 不动 `ContextMenuHost.host.tsx` 自己的 selectionchange listener(它是 overlay rect 实时更新用,
// 不是 history 用,职责不同;它本身是 Singleton 没有 N×问题).
//
// === 隔离边界 ===
//
// 注册的 viewerRoot **必须**是稳定的实例 scope 标识(典型:每个 `FileTabContent` 的
// `<Tabs.Content>` 节点)。跨 tab 各注册一个,bus 按 `isAnchorInsideViewer` 路由 — first match 即停。
// 假定 viewer 之间不嵌套(实际就是不嵌套,FileTabContent 互为同辈)。

import { isAnchorInsideViewer } from "./file-tabs-ctrl-c"
import { ViewerSelectionHistory } from "./selection-history"

type Registration = {
  viewerRoot: HTMLElement
  history: ViewerSelectionHistory
}

const registrations = new Set<Registration>()
let listenerAttached = false

function onSelectionChange(): void {
  if (typeof window === "undefined") return
  const sel = window.getSelection()
  if (!sel) return
  // First-match-wins:viewer 互不嵌套,匹到第一个即终止。
  for (const reg of registrations) {
    if (isAnchorInsideViewer(sel.anchorNode, reg.viewerRoot)) {
      reg.history.pushFromSelection(sel)
      return
    }
  }
}

function ensureListenerAttached(): void {
  if (listenerAttached || typeof document === "undefined") return
  document.addEventListener("selectionchange", onSelectionChange)
  listenerAttached = true
}

function detachListenerIfEmpty(): void {
  if (!listenerAttached || registrations.size > 0 || typeof document === "undefined") return
  document.removeEventListener("selectionchange", onSelectionChange)
  listenerAttached = false
}

/**
 * 注册一个 viewer 到 selection bus。
 *
 * 返回 `{ history, destroy }`:
 * - `history`:本 viewer 的 `ViewerSelectionHistory` 实例,用 `.pushFromSelection / .pickBestRecent / .readSelection / .collectShadow*` 等
 * - `destroy()`:Solid `onCleanup(() => reg.destroy())` 里调,从 registry 注销,最后一个走时 detach 全局 listener
 *
 * 典型用法(SolidJS 组件 onMount 内):
 * ```
 * onMount(() => {
 *   if (!viewerRootRef) return
 *   const reg = registerViewer(viewerRootRef)
 *   viewerHistory = reg.history
 *   onCleanup(() => reg.destroy())
 * })
 * ```
 */
export function registerViewer(viewerRoot: HTMLElement): {
  history: ViewerSelectionHistory
  destroy: () => void
} {
  const history = new ViewerSelectionHistory()
  const reg: Registration = { viewerRoot, history }
  registrations.add(reg)
  ensureListenerAttached()

  return {
    history,
    destroy() {
      registrations.delete(reg)
      detachListenerIfEmpty()
    },
  }
}

/** 测试 / debug 用:当前注册数 */
export function _registrationCount(): number {
  return registrations.size
}

/** 测试用:强制重置(测试间清理)*/
export function _resetBus(): void {
  registrations.clear()
  if (listenerAttached && typeof document !== "undefined") {
    document.removeEventListener("selectionchange", onSelectionChange)
  }
  listenerAttached = false
}
