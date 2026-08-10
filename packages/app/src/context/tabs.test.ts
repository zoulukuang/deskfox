import { describe, expect, test } from "bun:test"
import { createRoot, getOwner, onCleanup } from "solid-js"
import { createTabMemory } from "./tab-memory"
import { nextTabAfterClose, pushClosedTab, removeClosedTabs, takeClosedTab, type ClosedTab } from "./closed-tabs"
import type { SessionTab, Tab } from "./tabs"
import { sessionHasOpenTab } from "./tabs"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "./server"

const server = "local\nhttp://localhost:4096" as ServerConnection.Key

function sessionTab(sessionId: string): SessionTab {
  return { type: "session", server, sessionId }
}

describe("tab memory", () => {
  test("keeps state until its tab is removed", () => {
    createRoot((dispose) => {
      const memory = createTabMemory(getOwner())
      let disposed = 0
      const first = memory.ensure("tab", "prompt", () => {
        onCleanup(() => disposed++)
        return { value: "prompt" }
      })

      expect(memory.ensure("tab", "prompt", () => ({ value: "other" }))).toBe(first)
      expect(memory.get<typeof first>("tab", "prompt")).toBe(first)
      expect(memory.get("missing", "prompt")).toBeUndefined()
      expect(memory.ensure("other", "prompt", () => ({ value: "other" }))).not.toBe(first)

      memory.remove("tab")
      expect(disposed).toBe(1)
      expect(memory.ensure("tab", "prompt", () => ({ value: "new" }))).not.toBe(first)
      dispose()
    })
  })
})

describe("closed tab stack", () => {
  test("records session tabs with their index", () => {
    const stack = pushClosedTab([], sessionTab("a"), 2)

    expect(stack).toEqual([{ tab: sessionTab("a"), index: 2 }])
  })

  test("ignores draft tabs", () => {
    const draft: Tab = { type: "draft", draftID: "d1", server, directory: "/tmp" }

    expect(pushClosedTab([], draft, 0)).toEqual([])
  })

  test("caps the stack size", () => {
    const stack = Array.from({ length: 30 }, (_, i) => i).reduce<ClosedTab[]>(
      (acc, i) => pushClosedTab(acc, sessionTab(`s${i}`), i),
      [],
    )

    expect(stack).toHaveLength(25)
    expect(stack[0]?.tab.sessionId).toBe("s5")
    expect(stack.at(-1)?.tab.sessionId).toBe("s29")
  })

  test("pops the most recently closed tab", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]
    const result = takeClosedTab(stack, [])

    expect(result.entry?.tab.sessionId).toBe("b")
    expect(result.stack).toEqual([{ tab: sessionTab("a"), index: 0 }])
  })

  test("skips entries whose tab is already open", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]
    const result = takeClosedTab(stack, [sessionTab("b")])

    expect(result.entry?.tab.sessionId).toBe("a")
    expect(result.stack).toEqual([])
  })

  test("returns no entry when everything is open or empty", () => {
    expect(takeClosedTab([], []).entry).toBeUndefined()

    const result = takeClosedTab([{ tab: sessionTab("a"), index: 0 }], [sessionTab("a")])
    expect(result.entry).toBeUndefined()
    expect(result.stack).toEqual([])
  })

  test("purges removed sessions", () => {
    const stack = [
      { tab: sessionTab("a"), index: 0 },
      { tab: sessionTab("b"), index: 1 },
    ]

    expect(removeClosedTabs(stack, server, ["a"])).toEqual([{ tab: sessionTab("b"), index: 1 }])
  })

  test("does not navigate when a background tab closes", () => {
    const tabs = [sessionTab("a"), sessionTab("b"), sessionTab("c")]

    expect(nextTabAfterClose(tabs, 1, false)).toBeUndefined()
    expect(nextTabAfterClose(tabs, 1, true)).toEqual(sessionTab("c"))
    expect(nextTabAfterClose([sessionTab("a")], 0, true)).toBeNull()
  })
})


// REQ-072: sessionHasOpenTab 按 server + session.id 去重(不再按 session.directory)
// 防改名/挪位项目会话因 session.directory=旧路径 与当前有效目录失配 → 误判「未开」→ 开重复 tab。

const forkServer = "server-1" as ServerConnection.Key
const forkOther = "server-2" as ServerConnection.Key

// 2026-08-11 sync v1.17.13:上游 SessionTab 去掉 dirBase64(href 改 server-keyed),第二参保留仅为兼容旧用例签名
const forkSessionTab = (sessionId: string, _dirBase64?: string): Tab => ({
  type: "session",
  server: forkServer,
  sessionId,
})

const session = (id: string, directory: string) => ({ id, directory }) as unknown as Session

describe("sessionHasOpenTab (REQ-072 改名项目去重)", () => {
  // TC-T1: 改名项目 — tab.dirBase64=新路径、session.directory=旧路径,只要 id 命中即算已开
  test("TC-T1: 已开 tab 的会话即使 directory 失配也判定为已开(不开重复 tab)", () => {
    const tabs = [forkSessionTab("ses_abc", "bmV3LXBhdGg=" /* 新路径 base64 */)]
    // session.directory 是旧路径,与 tab.dirBase64(新路径)不同 —— 旧逻辑会误判「未开」
    expect(sessionHasOpenTab(tabs, forkServer, session("ses_abc", "/old/path"))).toBe(true)
  })

  // TC-T2: 不同 session.id 不误判;跨 server 隔离
  test("TC-T2: 不同 session.id 判为未开", () => {
    const tabs = [forkSessionTab("ses_abc", "x")]
    expect(sessionHasOpenTab(tabs, forkServer, session("ses_zzz", "/old/path"))).toBe(false)
  })

  test("TC-T2b: 同 id 不同 server → 判为未开(server 隔离)", () => {
    const tabs = [forkSessionTab("ses_abc", "x")]
    expect(sessionHasOpenTab(tabs, forkOther, session("ses_abc", "/old/path"))).toBe(false)
  })

  test("draft tab 不参与 session 去重", () => {
    const tabs: Tab[] = [{ type: "draft", server, draftID: "d1", directory: "/x" }]
    expect(sessionHasOpenTab(tabs, forkServer, session("ses_abc", "/x"))).toBe(false)
  })
})
