// [fork-only] voice-acp-bridge — sidecar 客户端:模型跟随的过滤逻辑 [feat: voice-acp-bridge] 2026-08-25
//
// 这组用例守的是一个真机实撞的自我锁死:语音第一次用了模型 X → 它建的 session 记着 X →
// 下次查"最近用过的"又读到 X ——**用户在界面上怎么换都没用**
// (2026-08-25:界面明明选着 Claude Opus,任务却一直跑 Qwen3.8 Max)。
import { describe, expect, test } from "bun:test"
import { createSidecarClient, VOICE_SESSION_MARK } from "./sidecar"

/** 造一个只回放固定 session 列表的假 sidecar */
function client(sessions: unknown[], onPost?: (body: any) => void) {
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      onPost?.(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ id: "ses_new" }), { status: 200 })
    }
    return new Response(JSON.stringify(sessions), { status: 200 })
  }) as unknown as typeof fetch
  return createSidecarClient({ baseUrl: "http://x", authorization: "Basic x", fetch: fakeFetch })
}

const userSession = (id: string, provider: string, model: string) => ({
  id,
  model: { id: model, providerID: provider },
})
const voiceSession = (id: string, provider: string, model: string) => ({
  id,
  model: { id: model, providerID: provider },
  metadata: { [VOICE_SESSION_MARK]: true },
})

describe("recentModel — 只认用户手敲的会话", () => {
  test("跳过语音自己建的,读到用户真正在用的模型", async () => {
    const c = client([
      voiceSession("ses_v2", "alibaba-cn", "qwen3.8-max"),
      voiceSession("ses_v1", "alibaba-cn", "qwen3.8-max"),
      userSession("ses_u1", "claude-code", "opus"),
    ])
    expect(await c.recentModel("/proj")).toEqual({ providerID: "claude-code", modelID: "opus" })
  })

  test("最新一条就是用户的 → 直接用它(换了模型立刻跟上)", async () => {
    const c = client([userSession("ses_u2", "claude-code", "fable"), userSession("ses_u1", "claude-code", "opus")])
    expect(await c.recentModel("/proj")).toEqual({ providerID: "claude-code", modelID: "fable" })
  })

  test("全是语音建的(用户还没在这儿手敲过)→ null,交给调用方回落", async () => {
    const c = client([voiceSession("ses_v1", "alibaba-cn", "qwen3.8-max")])
    expect(await c.recentModel("/proj")).toBeNull()
  })

  test("空列表 / 没有 model 字段的 session → null", async () => {
    expect(await client([]).recentModel("/proj")).toBeNull()
    expect(await client([{ id: "ses_x" }]).recentModel("/proj")).toBeNull()
  })

  test("请求失败不抛,回 null(拿不到就回落,别让语音起不来)", async () => {
    const bad = createSidecarClient({
      baseUrl: "http://x",
      authorization: "Basic x",
      fetch: (async () => {
        throw new Error("boom")
      }) as unknown as typeof fetch,
    })
    expect(await bad.recentModel("/proj")).toBeNull()
  })
})

describe("createSession — 打语音标记", () => {
  test("建的 session 一律带标记(否则会污染模型跟随)", async () => {
    let body: any
    await client([], (b) => (body = b)).createSession("/proj")
    expect(body.metadata[VOICE_SESSION_MARK]).toBe(true)
  })

  test("标题与标记并存", async () => {
    let body: any
    await client([], (b) => (body = b)).createSession("/proj", { title: "语音沟通" })
    expect(body.title).toBe("语音沟通")
    expect(body.metadata[VOICE_SESSION_MARK]).toBe(true)
  })
})
