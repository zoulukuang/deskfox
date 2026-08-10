import { describe, expect, test } from "bun:test"
import { createRoot, getOwner, onCleanup } from "solid-js"
import { createTabMemory } from "./tab-memory"

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
      expect(memory.ensure("other", "prompt", () => ({ value: "other" }))).not.toBe(first)

      memory.remove("tab")
      expect(disposed).toBe(1)
      expect(memory.ensure("tab", "prompt", () => ({ value: "new" }))).not.toBe(first)
      dispose()
    })
  })
})

import type { Session } from "@opencode-ai/sdk/v2/client"
import { sessionHasOpenTab } from "./tabs"
import type { Tab } from "./tabs"
import type { ServerConnection } from "./server"

// REQ-072: sessionHasOpenTab 按 server + session.id 去重(不再按 session.directory)
// 防改名/挪位项目会话因 session.directory=旧路径 与当前有效目录失配 → 误判「未开」→ 开重复 tab。

const server = "server-1" as ServerConnection.Key
const other = "server-2" as ServerConnection.Key

// 2026-08-11 sync v1.17.13:上游 SessionTab 去掉 dirBase64(href 改 server-keyed),第二参保留仅为兼容旧用例签名
const sessionTab = (sessionId: string, _dirBase64?: string): Tab => ({
  type: "session",
  server,
  sessionId,
})

const session = (id: string, directory: string) => ({ id, directory }) as unknown as Session

describe("sessionHasOpenTab (REQ-072 改名项目去重)", () => {
  // TC-T1: 改名项目 — tab.dirBase64=新路径、session.directory=旧路径,只要 id 命中即算已开
  test("TC-T1: 已开 tab 的会话即使 directory 失配也判定为已开(不开重复 tab)", () => {
    const tabs = [sessionTab("ses_abc", "bmV3LXBhdGg=" /* 新路径 base64 */)]
    // session.directory 是旧路径,与 tab.dirBase64(新路径)不同 —— 旧逻辑会误判「未开」
    expect(sessionHasOpenTab(tabs, server, session("ses_abc", "/old/path"))).toBe(true)
  })

  // TC-T2: 不同 session.id 不误判;跨 server 隔离
  test("TC-T2: 不同 session.id 判为未开", () => {
    const tabs = [sessionTab("ses_abc", "x")]
    expect(sessionHasOpenTab(tabs, server, session("ses_zzz", "/old/path"))).toBe(false)
  })

  test("TC-T2b: 同 id 不同 server → 判为未开(server 隔离)", () => {
    const tabs = [sessionTab("ses_abc", "x")]
    expect(sessionHasOpenTab(tabs, other, session("ses_abc", "/old/path"))).toBe(false)
  })

  test("draft tab 不参与 session 去重", () => {
    const tabs: Tab[] = [{ type: "draft", server, draftID: "d1", directory: "/x" }]
    expect(sessionHasOpenTab(tabs, server, session("ses_abc", "/x"))).toBe(false)
  })
})
