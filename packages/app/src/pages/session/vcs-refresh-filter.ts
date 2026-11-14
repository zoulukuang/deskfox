import { debounce } from "@solid-primitives/scheduled"
import { hashKey, type QueryKey } from "@tanstack/solid-query"
import { createEffect, onCleanup } from "solid-js"
import type { DirectorySDK } from "@/context/sdk"

type Options = {
  key: () => QueryKey
  directory: () => string
  required: (directory: string, paths: string[], signal: AbortSignal) => Promise<boolean>
  refresh: () => void
}

export function createSessionVcsRefreshFilter(sdk: () => DirectorySDK, key: () => QueryKey, refresh: () => void) {
  return createVcsRefreshFilter({
    key: () => [sdk().url, ...key()],
    directory: () => sdk().directory,
    refresh,
    required: (directory, paths, signal) =>
      sdk()
        .client.vcsRefresh.required({ directory, paths }, { signal })
        .then((result) => result.data?.shouldRefresh !== false),
  })
}

// One classification in flight, one bounded pending batch; never an HTTP queue.
export function createVcsRefreshFilter(options: Options) {
  const pending = new Set<string>()
  let bytes = 0
  let force = false
  let disposed = false
  let current = hashKey(options.key())
  let active: AbortController | undefined
  const flush = debounce(() => {
    if (active || disposed) return
    if (force) {
      force = false
      options.refresh()
      return
    }
    if (!pending.size) return
    const paths = [...pending]
    pending.clear()
    bytes = 0
    const key = current
    const directory = options.directory()
    const controller = new AbortController()
    active = controller
    const timer = setTimeout(() => controller.abort(), 1500)
    const aborted = new Promise<boolean>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve(true), { once: true })
    })
    const request = async () => options.required(directory, paths, controller.signal)
    void Promise.race([request(), aborted])
      .catch(() => true)
      .then((required) => {
        if (!disposed && key === current && required !== false) options.refresh()
      })
      .finally(() => {
        clearTimeout(timer)
        active = undefined
        if (!disposed && (pending.size || force)) flush()
      })
  }, 100)

  createEffect(() => {
    const key = hashKey(options.key())
    if (key === current) return
    current = key
    pending.clear()
    bytes = 0
    force = false
    flush.clear()
    active?.abort()
  })
  onCleanup(() => {
    disposed = true
    pending.clear()
    flush.clear()
    active?.abort()
  })

  return (file: string) => {
    if (disposed) return
    if (!force && !pending.has(file)) {
      const size = new TextEncoder().encode(file).byteLength
      bytes += size
      if (!file || file.includes("\0") || size > 4096 || pending.size >= 128 || bytes > 65536) {
        force = true
        pending.clear()
        bytes = 0
      } else pending.add(file)
    }
    flush()
  }
}
