// FORK-ONLY: scoped Markdown fragment navigation [feat: daily-file-links] 2026-11-14
import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { resolveAbsolute } from "@/utils/local-asset"

const [requested, setRequested] = createSignal<{ file: string; fragment: string }>()

export function scrollMdFragment(scope: Element | null | undefined, fragment: string) {
  if (!scope || !fragment) return false
  const ids = [fragment, `user-content-${fragment}`, fragment.replace(/^user-content-/, "")]
  const target = Array.from(scope.querySelectorAll<HTMLElement>("[id]")).find((el) => ids.includes(el.id))
  if (!target) return false
  target.scrollIntoView({ block: "start" })
  return true
}

export function requestMdFragment(root: string, path: string, fragment: string) {
  setRequested(fragment ? { file: resolveAbsolute(root, path), fragment } : undefined)
}

export function createMdFragmentNavigation(
  container: () => HTMLElement | undefined,
  root: () => string | undefined,
  path: () => string | undefined,
  active: () => boolean = () => true,
  onScroll?: () => void,
) {
  let claimed: ReturnType<typeof requested>
  onCleanup(() => {
    // Suspense can discard a viewer before its effects run. Only the viewer
    // that actually started waiting for this request may cancel it.
    if (claimed && requested() === claimed) setRequested(undefined)
  })
  createEffect(() => {
    const request = requested()
    const scope = container()
    const directory = root()
    const file = path()
    if (!request || !scope || !directory || !file || !active()) return
    if (request.file !== resolveAbsolute(directory, file)) return
    claimed = request
    const scroll = () => {
      if (requested() !== request) return
      if (!scrollMdFragment(scope, request.fragment)) return
      untrack(() => onScroll?.())
      setRequested(undefined)
    }
    // Markdown parsing is asynchronous: wait for this document's heading DOM.
    const observer = new MutationObserver(scroll)
    observer.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ["id"] })
    onCleanup(() => observer.disconnect())
    scroll()
  })
}
