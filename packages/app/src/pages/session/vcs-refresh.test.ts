import { describe, expect, test } from "bun:test"
import { QueryClient, type QueryKey } from "@tanstack/solid-query"
import { createRoot, createSignal } from "solid-js"
import { createVcsRefresh } from "./vcs-refresh"

const initialKey = ["session-vcs", "/repo", "main", "main"] as const

function setup() {
  return createRoot((dispose) => {
    const client = new QueryClient()
    client.setQueryData(initialKey, [])
    const [key, setKey] = createSignal<QueryKey>(initialKey)
    const [fetching, setFetching] = createSignal(true)
    const refresh = createVcsRefresh(client, key, fetching)
    return {
      client,
      refresh,
      setKey,
      setFetching,
      invalidated: () => client.getQueryState(initialKey)?.isInvalidated,
      dispose: () => {
        dispose()
        client.clear()
      },
    }
  })
}

describe("VCS refresh query identity", () => {
  test("keeps the pending refresh when an equal query key is recreated", async () => {
    const state = setup()
    try {
      state.refresh()
      await Bun.sleep(150)
      expect(state.invalidated()).toBe(false)
      state.setKey([...initialKey])
      state.setFetching(false)
      expect(state.invalidated()).toBe(true)
    } finally {
      state.dispose()
    }
  })

  test.each([
    ["session-vcs", "/other", "main", "main"],
    ["session-vcs", "/repo", "feature", "main"],
    ["session-vcs", "/repo", "main", "develop"],
  ])("discards pending work after a real query change: %j", async (...next) => {
    const state = setup()
    try {
      state.refresh()
      await Bun.sleep(150)
      state.client.setQueryData(next, [])
      state.setKey(next)
      state.setFetching(false)
      expect(state.invalidated()).toBe(false)
      expect(state.client.getQueryState(next)?.isInvalidated).toBe(false)
    } finally {
      state.dispose()
    }
  })

  test("coalesces a burst until the active request finishes", async () => {
    const state = setup()
    try {
      for (let i = 0; i < 8; i++) state.refresh()
      await Bun.sleep(150)
      expect(state.invalidated()).toBe(false)
      state.setFetching(false)
      expect(state.invalidated()).toBe(true)
      state.client.setQueryData(initialKey, [])
      state.setFetching(true)
      state.setFetching(false)
      expect(state.invalidated()).toBe(false)
    } finally {
      state.dispose()
    }
  })

  test("does not invalidate an old query if switching during the debounce", async () => {
    const state = setup()
    try {
      state.refresh()
      state.setKey(["session-vcs", "/other", "main", "main"])
      state.setFetching(false)
      await Bun.sleep(150)
      expect(state.invalidated()).toBe(false)
    } finally {
      state.dispose()
    }
  })
})
