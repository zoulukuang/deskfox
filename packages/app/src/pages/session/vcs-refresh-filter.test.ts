import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createVcsRefreshFilter } from "./vcs-refresh-filter"

function setup() {
  return createRoot((dispose) => {
    const [directory, setDirectory] = createSignal("/repo")
    const calls: {
      directory: string
      paths: string[]
      signal: AbortSignal
      resolve: (value: boolean) => void
      reject: (error: Error) => void
    }[] = []
    let refreshes = 0
    const send = createVcsRefreshFilter({
      key: () => ["vcs", directory()],
      directory,
      refresh: () => {
        refreshes++
      },
      required: (directory, paths, signal) =>
        new Promise<boolean>((resolve, reject) => calls.push({ directory, paths, signal, resolve, reject })),
    })
    return { send, calls, setDirectory, dispose, refreshes: () => refreshes }
  })
}

test("deduplicates ignored events with one in-flight classification and one pending batch", async () => {
  const state = setup()
  try {
    for (let i = 0; i < 20; i++) state.send("/repo/ignored.log")
    await Bun.sleep(150)
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0].paths).toEqual(["/repo/ignored.log"])
    for (let i = 0; i < 8; i++) state.send("/repo/next.log")
    await Bun.sleep(150)
    expect(state.calls).toHaveLength(1)
    state.calls[0].resolve(false)
    await Bun.sleep(150)
    expect(state.calls).toHaveLength(2)
    state.calls[1].resolve(false)
    await Bun.sleep(0)
    expect(state.refreshes()).toBe(0)
  } finally {
    state.dispose()
  }
})

test("mixed paths refresh once, and request failures conservatively refresh", async () => {
  const state = setup()
  try {
    state.send("ignored.log")
    state.send("tracked.ts")
    await Bun.sleep(150)
    expect(state.calls[0].paths).toEqual(["ignored.log", "tracked.ts"])
    state.calls[0].resolve(true)
    await Bun.sleep(0)
    expect(state.refreshes()).toBe(1)
    state.send("next.ts")
    await Bun.sleep(150)
    state.calls[1].reject(new Error("offline"))
    await Bun.sleep(0)
    expect(state.refreshes()).toBe(2)
  } finally {
    state.dispose()
  }
})

test("bounded overflow becomes a refresh, not queued requests", async () => {
  const state = setup()
  try {
    state.send("initial.log")
    await Bun.sleep(150)
    for (let i = 0; i < 1000; i++) state.send(`file-${i}.log`)
    await Bun.sleep(150)
    expect(state.calls).toHaveLength(1)
    state.calls[0].resolve(false)
    await Bun.sleep(150)
    expect(state.calls).toHaveLength(1)
    expect(state.refreshes()).toBe(1)
    state.send("x".repeat(4097))
    await Bun.sleep(150)
    expect(state.calls).toHaveLength(1)
    expect(state.refreshes()).toBe(2)
    for (let i = 0; i < 100; i++) state.send(`${i}${"中".repeat(300)}`)
    await Bun.sleep(150)
    expect(state.calls).toHaveLength(1)
    expect(state.refreshes()).toBe(3)
  } finally {
    state.dispose()
  }
})

test("workspace switches abort old requests and cannot refresh the new workspace", async () => {
  const state = setup()
  try {
    state.send("old.ts")
    await Bun.sleep(150)
    state.send("old-pending.ts")
    state.setDirectory("/other")
    expect(state.calls[0].signal.aborted).toBe(true)
    state.send("new.ts")
    state.calls[0].resolve(true)
    await Bun.sleep(150)
    expect(state.refreshes()).toBe(0)
    expect(state.calls[1].directory).toBe("/other")
    expect(state.calls[1].paths).toEqual(["new.ts"])
    state.calls[1].resolve(true)
    await Bun.sleep(0)
    expect(state.refreshes()).toBe(1)
  } finally {
    state.dispose()
  }
})

test("disposal cancels a pending debounce and an in-flight request", async () => {
  const pending = setup()
  pending.send("old.ts")
  pending.dispose()
  await Bun.sleep(150)
  expect(pending.calls).toHaveLength(0)
  const active = setup()
  active.send("old.ts")
  await Bun.sleep(150)
  active.dispose()
  expect(active.calls[0].signal.aborted).toBe(true)
  active.calls[0].resolve(true)
  await Bun.sleep(0)
  expect(active.refreshes()).toBe(0)
})

test("a hanging transport times out once and ignores its late result", async () => {
  const state = setup()
  try {
    state.send("slow.ts")
    await Bun.sleep(1750)
    expect(state.calls[0].signal.aborted).toBe(true)
    expect(state.refreshes()).toBe(1)
    state.calls[0].resolve(true)
    await Bun.sleep(0)
    expect(state.refreshes()).toBe(1)
  } finally {
    state.dispose()
  }
})
