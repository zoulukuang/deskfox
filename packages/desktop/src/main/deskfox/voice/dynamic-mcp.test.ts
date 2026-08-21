// [fork-only] REQ-102 语音派活 — 动态 MCP 旁路单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 2-plan「B2:动态 MCP 透传」。样本取自 2026-08-21 tee 抓到的**真实帧**。
import { describe, expect, test } from "bun:test"
import { extractMcpServers, mcpSnapshotChanged, normalizeMcpServers } from "./dynamic-mcp"

// 真实帧(节选自 acp-frames.log),别改成手编的 —— 结构对不上就白测了
const RESUME_FRAME = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "session/resume",
  params: {
    sessionId: "ses_x",
    cwd: "/Users/openclaw/voice-test",
    mcpServers: [
      {
        type: "http",
        name: "qwen_audio_agent",
        url: "http://127.0.0.1:51411/mcp",
        headers: [{ name: "Authorization", value: "Bearer 8d6995c6" }],
      },
      {
        name: "open-computer-use",
        command: "/node",
        args: ["/pkg/bin/open-computer-use", "mcp"],
        env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
      },
    ],
  },
})

describe("extractMcpServers", () => {
  test("从 session/resume 帧里抽出两个 server", () => {
    const r = extractMcpServers(RESUME_FRAME)
    expect(r?.length).toBe(2)
    expect(r?.map((s) => s.name)).toEqual(["qwen_audio_agent", "open-computer-use"])
  })

  // 首次建 coordinator 走 new,复用走 resume —— 两个都得认,漏一个就有一半场景抓不到
  test("session/new 也认", () => {
    const frame = JSON.stringify({ method: "session/new", params: { mcpServers: [{ name: "a", command: "/x" }] } })
    expect(extractMcpServers(frame)?.length).toBe(1)
  })

  test("其它方法 / 没有 mcpServers / 坏 JSON → null(不是目标帧就别管)", () => {
    expect(extractMcpServers(JSON.stringify({ method: "session/prompt", params: {} }))).toBeNull()
    expect(extractMcpServers(JSON.stringify({ method: "session/new", params: { mcpServers: [] } }))).toBeNull()
    expect(extractMcpServers("{ 不是 json")).toBeNull()
    expect(extractMcpServers("")).toBeNull()
  })

  test("丢掉没有 name 的畸形条目", () => {
    const frame = JSON.stringify({ method: "session/new", params: { mcpServers: [{ url: "http://x" }, { name: "ok", command: "/x" }] } })
    expect(extractMcpServers(frame)?.map((s) => s.name)).toEqual(["ok"])
  })
})

describe("normalizeMcpServers", () => {
  test("headers / env 由 {name,value}[] 拍平成对象", () => {
    const r = normalizeMcpServers(extractMcpServers(RESUME_FRAME)!)
    expect(r.qwen_audio_agent).toEqual({
      type: "http",
      url: "http://127.0.0.1:51411/mcp",
      headers: { Authorization: "Bearer 8d6995c6" },
    })
    expect(r["open-computer-use"]).toEqual({
      command: "/node",
      args: ["/pkg/bin/open-computer-use", "mcp"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    })
  })

  test("空 headers / 空 args 不产出空字段(下游少一个歧义源)", () => {
    const r = normalizeMcpServers([{ type: "http", name: "a", url: "http://x", headers: [] }])
    expect(r.a).toEqual({ type: "http", url: "http://x" })
  })

  test("type 原样保留,不替下游做语义决定", () => {
    const r = normalizeMcpServers([{ type: "sse", name: "a", url: "http://x" }])
    expect(r.a.type).toBe("sse")
  })
})

describe("mcpSnapshotChanged", () => {
  // qwen 每次 register 生成新 token;token 变了还写旧的 = 给 CLI 一把过期钥匙
  test("token 变了算变", () => {
    const a = normalizeMcpServers([
      { type: "http", name: "q", url: "http://x", headers: [{ name: "Authorization", value: "Bearer 1" }] },
    ])
    const b = normalizeMcpServers([
      { type: "http", name: "q", url: "http://x", headers: [{ name: "Authorization", value: "Bearer 2" }] },
    ])
    expect(mcpSnapshotChanged(JSON.stringify(a), b)).toBe(true)
  })

  test("完全一样 → 不算变(别每帧都写盘)", () => {
    const a = normalizeMcpServers(extractMcpServers(RESUME_FRAME)!)
    expect(mcpSnapshotChanged(JSON.stringify(a), a)).toBe(false)
  })
})
