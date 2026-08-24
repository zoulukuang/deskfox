// [fork-only] voice-acp-bridge — TC-U1 ACP 帧解析/组装 [feat: voice-acp-bridge] 2026-08-24
//
// 重点验三件在真机上会以隐蔽方式坏掉的事:
//   · 非 JSON 行必须容错(不能让一行噪声掐断整条语音链路);
//   · **每个 request 都必须最终有响应** —— qwen 那边所有超时都是空转的,悬而不答 = session 永久锁死;
//   · `_meta` 之类未知字段原样透传,不擅自改形状。
import { describe, expect, test } from "bun:test"
import { createPeer, RPC_INTERNAL_ERROR, RPC_METHOD_NOT_FOUND, type Peer } from "./protocol"

function harness(): { peer: Peer; out: unknown[]; logs: string[] } {
  const out: unknown[] = []
  const logs: string[] = []
  const peer = createPeer({
    write: (line) => out.push(JSON.parse(line)),
    log: (m) => logs.push(m),
  })
  return { peer, out, logs }
}

const line = (o: unknown) => `${JSON.stringify(o)}\n`

describe("请求 → 响应", () => {
  test("同步 handler 的返回值成为 result,jsonrpc/id 原样带回", () => {
    const { peer, out } = harness()
    peer.on("initialize", () => ({ protocolVersion: 1 }))
    peer.handleChunk(line({ jsonrpc: "2.0", id: 7, method: "initialize", params: {} }))
    expect(out).toEqual([{ jsonrpc: "2.0", id: 7, result: { protocolVersion: 1 } }])
  })

  test("字符串 id 也能原样带回(SDK 允许 string|number)", () => {
    const { peer, out } = harness()
    peer.on("ping", () => ({ ok: true }))
    peer.handleChunk(line({ jsonrpc: "2.0", id: "abc", method: "ping" }))
    expect(out[0]).toMatchObject({ id: "abc" })
  })

  test("async handler 的 resolve 值成为 result", async () => {
    const { peer, out } = harness()
    peer.on("session/new", async () => ({ sessionId: "ses_1" }))
    peer.handleChunk(line({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/x" } }))
    await Promise.resolve()
    await Promise.resolve()
    expect(out).toEqual([{ jsonrpc: "2.0", id: 1, result: { sessionId: "ses_1" } }])
  })

  test("params 原样交给 handler(含 _meta 这类我们不认识的字段)", () => {
    const { peer } = harness()
    let seen: unknown
    peer.on("session/new", (p) => {
      seen = p
      return {}
    })
    const params = { cwd: "/x", mcpServers: [], _meta: { coordinator: true, nested: { a: 1 } } }
    peer.handleChunk(line({ jsonrpc: "2.0", id: 1, method: "session/new", params }))
    expect(seen).toEqual(params)
  })

  test("result 为 undefined/null 时补成 {} —— SDK 多处按对象解析", () => {
    const { peer, out } = harness()
    peer.on("session/load", () => null)
    peer.handleChunk(line({ jsonrpc: "2.0", id: 2, method: "session/load" }))
    expect(out).toEqual([{ jsonrpc: "2.0", id: 2, result: {} }])
  })
})

describe("错误路径 —— 绝不留下悬空的请求", () => {
  test("未实现的方法回 -32601,而不是沉默", () => {
    const { peer, out } = harness()
    peer.handleChunk(line({ jsonrpc: "2.0", id: 9, method: "terminal/create" }))
    expect(out[0]).toMatchObject({ id: 9, error: { code: RPC_METHOD_NOT_FOUND } })
  })

  test("handler 同步抛错 → -32603,人话进 data.details(qwen 直接拼给用户看)", () => {
    const { peer, out } = harness()
    peer.on("session/prompt", () => {
      throw new Error("sidecar 连不上")
    })
    peer.handleChunk(line({ jsonrpc: "2.0", id: 3, method: "session/prompt" }))
    expect(out[0]).toMatchObject({
      id: 3,
      error: { code: RPC_INTERNAL_ERROR, message: "sidecar 连不上", data: { details: "sidecar 连不上" } },
    })
  })

  test("handler 异步 reject → 同样回错误响应", async () => {
    const { peer, out } = harness()
    peer.on("session/new", async () => {
      throw new Error("建 session 失败")
    })
    peer.handleChunk(line({ jsonrpc: "2.0", id: 4, method: "session/new" }))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(out[0]).toMatchObject({ id: 4, error: { code: RPC_INTERNAL_ERROR, message: "建 session 失败" } })
  })

  test("未实现的**通知**静默忽略(qwen 会发我们没实现的通知,回错反而是噪声)", () => {
    const { peer, out, logs } = harness()
    peer.handleChunk(line({ jsonrpc: "2.0", method: "session/somethingNew", params: {} }))
    expect(out).toHaveLength(0)
    expect(logs.join()).toContain("session/somethingNew")
  })

  test("通知的 handler 抛错不产生响应,也不影响后续消息", () => {
    const { peer, out } = harness()
    peer.on("session/cancel", () => {
      throw new Error("boom")
    })
    peer.on("ping", () => ({ ok: 1 }))
    peer.handleChunk(line({ jsonrpc: "2.0", method: "session/cancel", params: {} }))
    peer.handleChunk(line({ jsonrpc: "2.0", id: 5, method: "ping" }))
    expect(out).toEqual([{ jsonrpc: "2.0", id: 5, result: { ok: 1 } }])
  })
})

describe("容错:脏输入不许掐断链路", () => {
  test("非 JSON 行跳过并记日志,后续帧照常处理", () => {
    const { peer, out, logs } = harness()
    peer.on("ping", () => ({ ok: 1 }))
    peer.handleChunk("这不是 json\n")
    peer.handleChunk(line({ jsonrpc: "2.0", id: 1, method: "ping" }))
    expect(out).toHaveLength(1)
    expect(logs.some((l) => l.includes("非 JSON"))).toBe(true)
  })

  test("JSON 数组 / 裸值跳过(客户端以 allowBatches:false 连接,不会有 batch)", () => {
    const { peer, out, logs } = harness()
    peer.handleChunk('[{"jsonrpc":"2.0","id":1,"method":"ping"}]\n')
    peer.handleChunk('"裸字符串"\n')
    expect(out).toHaveLength(0)
    expect(logs.filter((l) => l.includes("非对象"))).toHaveLength(2)
  })

  test("跨 chunk 的半行能拼回来(管道随时可能在任意字节切开)", () => {
    const { peer, out } = harness()
    peer.on("ping", () => ({ ok: 1 }))
    const frame = line({ jsonrpc: "2.0", id: 1, method: "ping" })
    peer.handleChunk(frame.slice(0, 9))
    expect(out).toHaveLength(0)
    peer.handleChunk(frame.slice(9))
    expect(out).toEqual([{ jsonrpc: "2.0", id: 1, result: { ok: 1 } }])
  })

  test("一次喂进多帧 → 逐条分发,顺序保持", () => {
    const { peer, out } = harness()
    peer.on("a", () => ({ n: 1 }))
    peer.on("b", () => ({ n: 2 }))
    peer.handleChunk(line({ jsonrpc: "2.0", id: 1, method: "a" }) + line({ jsonrpc: "2.0", id: 2, method: "b" }))
    expect(out.map((o) => (o as { result: { n: number } }).result.n)).toEqual([1, 2])
  })

  test("finish() 把残留的半行吐出来", () => {
    const { peer, out } = harness()
    peer.on("ping", () => ({ ok: 1 }))
    peer.handleChunk(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })) // 没有换行
    expect(out).toHaveLength(0)
    peer.finish()
    expect(out).toHaveLength(1)
  })
})

describe("主动发送", () => {
  test("notify 发无 id 的通知", () => {
    const { peer, out } = harness()
    peer.notify("session/update", { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk" } })
    expect(out[0]).toEqual({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk" } },
    })
  })

  test("request 发出后,对端的 result 能 resolve 回来", async () => {
    const { peer, out } = harness()
    const p = peer.request("session/request_permission", { sessionId: "s1" })
    const sent = out[0] as { id: number }
    expect(sent.id).toBeDefined()
    peer.handleChunk(line({ jsonrpc: "2.0", id: sent.id, result: { outcome: { outcome: "selected" } } }))
    expect(await p).toEqual({ outcome: { outcome: "selected" } })
  })

  test("对端回 error → request reject", async () => {
    const { peer, out } = harness()
    const p = peer.request("session/request_permission", {})
    const sent = out[0] as { id: number }
    peer.handleChunk(line({ jsonrpc: "2.0", id: sent.id, error: { code: -32601, message: "没这方法" } }))
    expect(p).rejects.toThrow("没这方法")
  })

  test("连接关闭时在途 request 全部 reject,不会永远挂着", async () => {
    const { peer } = harness()
    const p = peer.request("session/request_permission", {})
    peer.finish()
    expect(p).rejects.toThrow("连接已关闭")
  })
})

describe("迟发响应(长任务)", () => {
  test("handler 返回 undefined 时先不回,之后 respond 补上", () => {
    const { peer, out } = harness()
    let pending: number | string | undefined
    peer.on("session/prompt", (_p, ctx) => {
      pending = ctx.id
      return undefined
    })
    peer.handleChunk(line({ jsonrpc: "2.0", id: 11, method: "session/prompt" }))
    expect(out).toHaveLength(0) // 第三层可能挂几分钟,这期间不能回
    peer.respond(pending, { stopReason: "end_turn" })
    expect(out).toEqual([{ jsonrpc: "2.0", id: 11, result: { stopReason: "end_turn" } }])
  })

  test("respondError 也走 data.details", () => {
    const { peer, out } = harness()
    peer.respondError(12, "任务没接下来")
    expect(out[0]).toMatchObject({ id: 12, error: { data: { details: "任务没接下来" } } })
  })

  test("id 为 undefined(通知)时 respond 静默不发", () => {
    const { peer, out } = harness()
    peer.respond(undefined, { stopReason: "end_turn" })
    peer.respondError(undefined, "x")
    expect(out).toHaveLength(0)
  })
})
