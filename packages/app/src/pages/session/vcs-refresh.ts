import { debounce } from "@solid-primitives/scheduled"
import { hashKey, type QueryClient, type QueryKey } from "@tanstack/solid-query"
import { createEffect, createSignal } from "solid-js"

// A file watcher can invalidate the review faster than Git can finish a diff.
// Keep one pending refresh and let the current response finish first.
export function createVcsRefresh(queryClient: QueryClient, queryKey: () => QueryKey, isFetching: () => boolean) {
  const [pending, setPending] = createSignal<QueryKey>()
  const schedule = debounce((key: QueryKey) => setPending(key), 100)

  createEffect(() => {
    const key = pending()
    if (!key) return
    if (hashKey(key) !== hashKey(queryKey())) {
      setPending(undefined)
      return
    }
    if (isFetching()) return
    setPending(undefined)
    void queryClient.invalidateQueries({ queryKey: key }, { cancelRefetch: false })
  })

  return () => schedule(queryKey())
}
