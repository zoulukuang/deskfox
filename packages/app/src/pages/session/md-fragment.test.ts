import { afterEach, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createMdFragmentNavigation, requestMdFragment } from "./md-fragment"

afterEach(() => {
  document.body.replaceChildren()
  requestMdFragment("/repo", "", "")
})

function setup() {
  const container = document.createElement("div")
  document.body.append(container)
  return createRoot((dispose) => {
    const [path, setPath] = createSignal("guide.md")
    const [active, setActive] = createSignal(true)
    createMdFragmentNavigation(
      () => container,
      () => "/repo",
      path,
      active,
    )
    return { container, setPath, setActive, dispose }
  })
}

test("waits for the requested document's asynchronous heading render and consumes once", async () => {
  const state = setup()
  const calls: string[] = []
  try {
    requestMdFragment("/repo", "guide.md", "section")
    const heading = document.createElement("h2")
    heading.id = "user-content-section"
    heading.scrollIntoView = () => {
      calls.push(heading.id)
    }
    state.container.append(heading)
    await Bun.sleep(0)
    expect(calls).toEqual(["user-content-section"])
    state.container.append(document.createElement("p"))
    await Bun.sleep(0)
    expect(calls).toHaveLength(1)
  } finally {
    state.dispose()
  }
})

test("does not scroll a different file with the same heading", () => {
  const state = setup()
  const calls: string[] = []
  try {
    const heading = document.createElement("h2")
    heading.id = "section"
    heading.scrollIntoView = () => {
      calls.push(heading.id)
    }
    state.container.append(heading)
    requestMdFragment("/repo", "other.md", "section")
    expect(calls).toEqual([])
    state.setPath("other.md")
    expect(calls).toEqual(["section"])
  } finally {
    state.dispose()
  }
})

test("does not scroll another project's document or a disposed viewer", async () => {
  const state = setup()
  const calls: string[] = []
  const heading = document.createElement("h2")
  heading.id = "section"
  heading.scrollIntoView = () => {
    calls.push(heading.id)
  }
  state.container.append(heading)
  requestMdFragment("/other-project", "guide.md", "section")
  expect(calls).toEqual([])
  state.dispose()
  requestMdFragment("/repo", "guide.md", "section")
  state.container.append(document.createElement("p"))
  await Bun.sleep(0)
  expect(calls).toEqual([])
})

test("waits until the target viewer becomes active", () => {
  const state = setup()
  const calls: string[] = []
  try {
    state.setActive(false)
    const heading = document.createElement("h2")
    heading.id = "section"
    heading.scrollIntoView = () => {
      calls.push(heading.id)
    }
    state.container.append(heading)
    requestMdFragment("/repo", "guide.md", "section")
    expect(calls).toEqual([])
    state.setActive(true)
    expect(calls).toEqual(["section"])
  } finally {
    state.dispose()
  }
})

test("a discarded initial viewer does not cancel a request it never claimed", () => {
  requestMdFragment("/repo", "guide.md", "section")
  createRoot((dispose) => {
    createMdFragmentNavigation(
      () => undefined,
      () => "/repo",
      () => "guide.md",
    )
    dispose()
  })
  const state = setup()
  const calls: string[] = []
  try {
    const heading = document.createElement("h2")
    heading.id = "section"
    heading.scrollIntoView = () => {
      calls.push(heading.id)
    }
    state.container.append(heading)
    state.setActive(false)
    state.setActive(true)
    expect(calls).toEqual(["section"])
  } finally {
    state.dispose()
  }
})
