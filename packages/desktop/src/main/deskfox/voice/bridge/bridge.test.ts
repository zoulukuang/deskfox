// [fork-only] voice-acp-bridge — 桥组装层:六方法翻译的端到端行为 [feat: voice-acp-bridge] 2026-08-24
//
// 用假 sidecar(可控事件流)驱动真桥,验的是 1-spec §2.1 那条数据流在代码里真的成立:
// session/new → sidecar 建 session;prompt → prompt_async + 事件转发;idle → end_turn。
// 以及几条"错了就很难查"的边界:空轮次兜底、cancel 必须立刻回、断流不许把请求悬着。
import { describe, expect, test } from "bun:test"
import { createBridge, humanizeSidecarError } from "./bridge"
import type { SidecarClient, SidecarEvent } from "./sidecar"

const VOICE_DIR = "/home/u/.deskfox/voice"
const QWEN_HTTP = { type: "http", name: "qwen_audio_agent", url: "http://127.0.0.1:1/mcp", headers: [] }

interface Harness {
  send(msg: unknown): void
  out: any[]
  logs: string[]
  emit(directory: string, event: SidecarEvent): void
  calls: {
    created: { directory: string; title?: string }[]
    prompts: { directory: string; sessionID: string; text: string; system?: string; model?: unknown; tools?: unknown }[]
    aborts: { directory: string; sessionID: string }[]
    mcp: { directory: string; name: string }[]
    recentModelQueries: string[]
  }
  subscriptions: string[]
  dispose(): void
  /** 取最后一条对某个 id 的响应 */
  responseTo(id: number): any
  /** 取所有 session/update 通知 */
  updates(): any[]
}

function harness(
  opts: {
    activeProject?: string
    failPrompt?: string
    sessionIds?: string[]
    coordinatorModel?: any
    taskModel?: any
    recentModel?: any
  } = {},
): Harness {
  const out: any[] = []
  const logs: string[] = []
  const listeners = new Map<string, ((e: SidecarEvent) => void)[]>()
  const closers = new Map<string, (reason: string) => void>()
  const subscriptions: string[] = []
  const calls: Harness["calls"] = { created: [], prompts: [], aborts: [], mcp: [], recentModelQueries: [] }
  const ids = [...(opts.sessionIds ?? [])]
  let seq = 0

  const sidecar = {
    async createSession(directory: string, input?: { title?: string }) {
      calls.created.push({ directory, title: input?.title })
      return { id: ids.shift() ?? `ses_${++seq}` }
    },
    async promptAsync(
      directory: string,
      sessionID: string,
      parts: readonly { text: string }[],
      options?: { system?: string; model?: unknown; tools?: unknown },
    ) {
      calls.prompts.push({
        directory,
        sessionID,
        text: parts.map((p) => p.text).join(""),
        system: options?.system,
        model: options?.model ?? null,
        tools: options?.tools,
      })
      if (opts.failPrompt) throw new Error(opts.failPrompt)
    },
    async abort(directory: string, sessionID: string) {
      calls.aborts.push({ directory, sessionID })
    },
    async recentModel(directory: string) {
      calls.recentModelQueries.push(directory)
      return opts.recentModel === undefined ? null : opts.recentModel
    },
    async listSessions() {
      return [{ id: "ses_hist", title: "上次的活", directory: "/proj", time: { updated: 1_700_000_000_000 } }]
    },
    async addMcp(directory: string, name: string) {
      calls.mcp.push({ directory, name })
    },
    subscribeEvents(directory: string, onEvent: (e: SidecarEvent) => void, onClose?: (r: string) => void) {
      subscriptions.push(directory)
      listeners.set(directory, [...(listeners.get(directory) ?? []), onEvent])
      if (onClose) closers.set(directory, onClose)
      return () => listeners.delete(directory)
    },
  } as unknown as SidecarClient

  const bridge = createBridge({
    sidecar,
    voiceDir: VOICE_DIR,
    readActiveProject: () => opts.activeProject ?? "",
    coordinatorModel: opts.coordinatorModel ?? null,
    taskModel: opts.taskModel ?? null,
    write: (line) => out.push(JSON.parse(line)),
    log: (m) => logs.push(m),
  })

  return {
    send: (msg) => bridge.peer.handleChunk(`${JSON.stringify(msg)}\n`),
    out,
    logs,
    emit: (directory, event) => {
      for (const fn of listeners.get(directory) ?? []) fn(event)
    },
    calls,
    subscriptions,
    dispose: () => bridge.dispose(),
    responseTo: (id) => [...out].reverse().find((m) => m.id === id),
    updates: () => out.filter((m) => m.method === "session/update"),
  }
}

const idleFor = (sessionID: string): SidecarEvent => ({ type: "session.idle", properties: { sessionID } })
const textFor = (sessionID: string, text: string, partID = "prt_1"): SidecarEvent => ({
  type: "message.part.updated",
  properties: { sessionID, part: { id: partID, type: "text", text, messageID: "m1" } },
})
const tick = () => new Promise((r) => setTimeout(r, 0))

describe("initialize", () => {
  test("回 protocolVersion 严格为数字 1 —— 回错 qwen 直接杀进程树", () => {
    const h = harness()
    h.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } })
    expect(h.responseTo(1).result.protocolVersion).toBe(1)
  })

  test("声明 resume 与 list:不声明则续接 coordinator 与「查历史会话」都会废掉", () => {
    const h = harness()
    h.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const caps = h.responseTo(1).result.agentCapabilities
    expect(caps.sessionCapabilities.resume).toBeDefined()
    expect(caps.sessionCapabilities.list).toBeDefined()
    expect(caps.loadSession).toBe(true)
  })

  test("不谎报附件能力(声明了就得真能处理,语音输入本来是纯文本)", () => {
    const h = harness()
    h.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    expect(h.responseTo(1).result.agentCapabilities.promptCapabilities).toEqual({
      image: false,
      audio: false,
      embeddedContext: false,
    })
  })
})

describe("session/new", () => {
  test("coordinator:落 voice 目录、带「语音沟通」标题、注册派活 MCP", async () => {
    const h = harness({ activeProject: "/proj" })
    h.send({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/anything", mcpServers: [QWEN_HTTP] } })
    await tick()
    expect(h.calls.created[0]).toEqual({ directory: VOICE_DIR, title: "语音沟通" })
    expect(h.calls.mcp).toEqual([{ directory: VOICE_DIR, name: "qwen_audio_agent" }])
    expect(h.responseTo(1).result.sessionId).toBeTruthy()
  })

  // ★ 递归防护:第三层目录不许出现派活工具
  test("第三层:落当前项目、无标题、一个 MCP 都不注册", async () => {
    const h = harness({ activeProject: "/proj" })
    h.send({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/启动时的", mcpServers: [QWEN_HTTP] } })
    await tick()
    // 注意:带 qwen_audio_agent 就会被判成 coordinator,所以第三层的形态是不带它
    const h2 = harness({ activeProject: "/proj" })
    h2.send({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/启动时的", mcpServers: [] } })
    await tick()
    expect(h2.calls.created[0]).toEqual({ directory: "/proj", title: undefined })
    expect(h2.calls.mcp).toHaveLength(0)
  })

  test("建完立刻订阅该目录的事件流(不然首批进度会丢)", async () => {
    const h = harness({ activeProject: "/proj" })
    h.send({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/p", mcpServers: [] } })
    await tick()
    expect(h.subscriptions).toEqual(["/proj"])
  })

  test("建 session 失败 → 回 JSON-RPC 错误,不是沉默", async () => {
    const h = harness()
    h.send({ jsonrpc: "2.0", id: 1, method: "session/new", params: { mcpServers: [] } })
    await tick()
    expect(h.responseTo(1).error.message).toContain("无法确定 session 目录")
  })
})

describe("session/resume", () => {
  test("result 里**没有** sessionId(qwen 沿用它自己传的)—— 透明换新成立的原因", async () => {
    const h = harness({ activeProject: "/proj" })
    h.send({ jsonrpc: "2.0", id: 1, method: "session/resume", params: { sessionId: "旧id", cwd: "/p", mcpServers: [] } })
    await tick()
    expect(h.responseTo(1).result).toEqual({})
    expect(h.calls.created).toHaveLength(1)
  })

  test("同一 id 反复 resume 只建一次 session、MCP 也只注册一次(去重)", async () => {
    const h = harness()
    for (const id of [1, 2, 3]) {
      h.send({
        jsonrpc: "2.0",
        id,
        method: "session/resume",
        params: { sessionId: "coord", cwd: "/p", mcpServers: [QWEN_HTTP] },
      })
      await tick()
    }
    expect(h.calls.created).toHaveLength(1)
    expect(h.calls.mcp).toHaveLength(1)
  })

  test("session/load 与 resume 同一套处理", async () => {
    const h = harness()
    h.send({ jsonrpc: "2.0", id: 1, method: "session/load", params: { sessionId: "x", cwd: "/p", mcpServers: [] } })
    await tick()
    expect(h.responseTo(1).result).toEqual({})
  })
})

describe("session/prompt — 一轮任务的完整生命周期", () => {
  async function newSession(h: Harness, mcpServers: unknown[] = []) {
    h.send({ jsonrpc: "2.0", id: 100, method: "session/new", params: { cwd: "/p", mcpServers } })
    await tick()
    return h.responseTo(100).result.sessionId as string
  }

  test("prompt 转成 prompt_async;文本增量转发成 agent_message_chunk;idle → end_turn", async () => {
    const h = harness({ activeProject: "/proj", sessionIds: ["ses_a"] })
    const sid = await newSession(h)
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "统计文件数" }] } })
    await tick()
    expect(h.calls.prompts[0]).toMatchObject({ directory: "/proj", sessionID: "ses_a", text: "统计文件数" })
    expect(h.responseTo(1)).toBeUndefined() // 还没回:第三层可能挂几分钟

    h.emit("/proj", textFor("ses_a", "一共"))
    h.emit("/proj", textFor("ses_a", "一共 42 个"))
    expect(h.updates().map((u) => u.params.update.content.text)).toEqual(["一共", " 42 个"])
    // sessionId 用 ACP 侧的 id,qwen 只认它
    expect(h.updates()[0].params.sessionId).toBe(sid)

    h.emit("/proj", idleFor("ses_a"))
    expect(h.responseTo(1).result).toEqual({ stopReason: "end_turn" })
  })

  // ★ qwen 判空响应会丢弃 session 并**整轮重跑**(任务被执行两遍),代价远大于多播一句
  test("整轮没有文本输出时补一句兜底,避免 qwen 判 502 重跑", async () => {
    const h = harness({ activeProject: "/proj", sessionIds: ["ses_a"] })
    const sid = await newSession(h)
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "x" }] } })
    await tick()
    h.emit("/proj", idleFor("ses_a"))
    const texts = h.updates().map((u) => u.params.update.content.text)
    expect(texts).toEqual(["(本轮没有产生文本输出)"])
    expect(h.responseTo(1).result.stopReason).toBe("end_turn")
  })

  test("有文本时不补兜底", async () => {
    const h = harness({ activeProject: "/proj", sessionIds: ["ses_a"] })
    const sid = await newSession(h)
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "x" }] } })
    await tick()
    h.emit("/proj", textFor("ses_a", "结果是 42"))
    h.emit("/proj", idleFor("ses_a"))
    expect(h.updates()).toHaveLength(1)
  })

  test("sidecar 报错 → 把原因说出来(播报得到)再 end_turn,而不是静静失败", async () => {
    const h = harness({ activeProject: "/proj", sessionIds: ["ses_a"] })
    const sid = await newSession(h)
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "x" }] } })
    await tick()
    h.emit("/proj", { type: "session.error", properties: { sessionID: "ses_a", error: { data: { message: "API 403" } } } })
    const spoken = h.updates()[0].params.update.content.text
    expect(spoken).toContain("任务执行失败")
    // 播报的是人话而不是原始错误码 —— 对着麦克风的人听 "403" 没有任何用
    expect(spoken).toContain("代理")
    expect(h.responseTo(1).result.stopReason).toBe("end_turn")
    // 原文进日志,排查时还找得回来
    expect(h.logs.join("\n")).toContain("API 403")
  })

  test("发 prompt 失败 → 回错误响应,不把请求悬着", async () => {
    const h = harness({ activeProject: "/proj", failPrompt: "sidecar 拒绝了" })
    const sid = await newSession(h)
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "x" }] } })
    await tick()
    await tick()
    expect(h.responseTo(1).error.message).toContain("sidecar 拒绝了")
  })

  test("未知 sessionId → 明确报错", async () => {
    const h = harness()
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: "ses_不存在", prompt: [] } })
    await tick()
    expect(h.responseTo(1).error.message).toContain("未知的 sessionId")
  })

  test("同一 session 并发第二个 prompt → 明确报错(sidecar 侧并发会静默错配)", async () => {
    const h = harness({ activeProject: "/proj", sessionIds: ["ses_a"] })
    const sid = await newSession(h)
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "一" }] } })
    await tick()
    h.send({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "二" }] } })
    await tick()
    expect(h.responseTo(2).error.message).toContain("已有进行中的轮次")
    expect(h.calls.prompts).toHaveLength(1)
  })

  test("别的 session 的事件不会误结束本轮", async () => {
    const h = harness({ activeProject: "/proj", sessionIds: ["ses_a"] })
    const sid = await newSession(h)
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "x" }] } })
    await tick()
    h.emit("/proj", idleFor("ses_别人"))
    expect(h.responseTo(1)).toBeUndefined()
    h.emit("/proj", idleFor("ses_a"))
    expect(h.responseTo(1)).toBeDefined()
  })

  // ★ 2026-08-24 真机 QA:coordinator 跟随绑定模型时,4.6k 字信封把小上下文模型打 400,
  //   整条语音哑掉。coordinator 必须能单独指定模型,第三层则**不能**被指定(否则破坏同源)。
  test("coordinator 用指定的路由模型,第三层不指定(跟随 DeskFox 绑定)", async () => {
    const model = { providerID: "claude-code", modelID: "opus" }
    const h = harness({ activeProject: "/proj", coordinatorModel: model })

    h.send({ jsonrpc: "2.0", id: 10, method: "session/new", params: { cwd: "/p", mcpServers: [QWEN_HTTP] } })
    await tick()
    const coordId = h.responseTo(10).result.sessionId
    h.send({ jsonrpc: "2.0", id: 11, method: "session/prompt", params: { sessionId: coordId, prompt: [{ type: "text", text: "路由轮" }] } })
    await tick()

    h.send({ jsonrpc: "2.0", id: 20, method: "session/new", params: { cwd: "/p", mcpServers: [] } })
    await tick()
    const taskId = h.responseTo(20).result.sessionId
    h.send({ jsonrpc: "2.0", id: 21, method: "session/prompt", params: { sessionId: taskId, prompt: [{ type: "text", text: "干活" }] } })
    await tick()

    const coordPrompt = h.calls.prompts.find((p) => p.sessionID === coordId)!
    const taskPrompt = h.calls.prompts.find((p) => p.sessionID === taskId)!
    expect(coordPrompt.model).toEqual(model)
    expect(taskPrompt.model).toBeNull()
    // 路由引导同理:只给 coordinator
    expect(coordPrompt.system).toContain("deskfox-voice-routing")
    expect(taskPrompt.system).toBeUndefined()
  })

  // ★ 2026-08-24 真机 QA:coordinator 手里有 write/bash,就直接把活自己干了 ——
  //   第三层 session 一条没建,产物落在语音目录。靠 prompt 说服不牢,得把路堵死。
  test("coordinator 的写/执行工具被禁,第三层不受任何限制", async () => {
    const h = harness({ activeProject: "/proj" })

    h.send({ jsonrpc: "2.0", id: 10, method: "session/new", params: { cwd: "/p", mcpServers: [QWEN_HTTP] } })
    await tick()
    const coordId = h.responseTo(10).result.sessionId
    h.send({ jsonrpc: "2.0", id: 11, method: "session/prompt", params: { sessionId: coordId, prompt: [{ type: "text", text: "路由轮" }] } })
    await tick()

    h.send({ jsonrpc: "2.0", id: 20, method: "session/new", params: { cwd: "/p", mcpServers: [] } })
    await tick()
    const taskId = h.responseTo(20).result.sessionId
    h.send({ jsonrpc: "2.0", id: 21, method: "session/prompt", params: { sessionId: taskId, prompt: [{ type: "text", text: "干活" }] } })
    await tick()

    const coordTools = h.calls.prompts.find((p) => p.sessionID === coordId)!.tools as Record<string, boolean>
    expect(coordTools).toEqual({ bash: false, edit: false, write: false, patch: false })
    // 只读保留:一问一答的轻量查询本来就该留在协调 session 里回答
    expect(coordTools.read).toBeUndefined()
    expect(coordTools.grep).toBeUndefined()
    // 第三层是真正干活的,一个都不能禁
    expect(h.calls.prompts.find((p) => p.sessionID === taskId)!.tools).toBeUndefined()
  })

  test("没配 coordinator 模型时不传 model 字段(退化成跟随绑定,不是传 null 进去)", async () => {
    const h = harness({ activeProject: "/proj" })
    h.send({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/p", mcpServers: [QWEN_HTTP] } })
    await tick()
    const sid = h.responseTo(1).result.sessionId
    h.send({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "x" }] } })
    await tick()
    expect(h.calls.prompts[0].model).toBeNull()
  })

  test("轮次判别写进日志(排查时能一眼看出认没认出信封)", async () => {
    const h = harness({ activeProject: "/proj" })
    const sid = await newSession(h)
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "干净任务" }] } })
    await tick()
    expect(h.logs.join("\n")).toContain("允许派活=否")
  })
})

describe("session/cancel", () => {
  test("abort sidecar + 立刻回 cancelled(不回的话那条 session 永久锁死)", async () => {
    const h = harness({ activeProject: "/proj", sessionIds: ["ses_a"] })
    h.send({ jsonrpc: "2.0", id: 100, method: "session/new", params: { cwd: "/p", mcpServers: [] } })
    await tick()
    const sid = h.responseTo(100).result.sessionId
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "x" }] } })
    await tick()

    h.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: sid } })
    await tick()
    expect(h.calls.aborts).toEqual([{ directory: "/proj", sessionID: "ses_a" }])
    expect(h.responseTo(1).result).toEqual({ stopReason: "cancelled" })
  })

  test("cancel 是通知:不产生对它自己的响应", async () => {
    const h = harness({ activeProject: "/proj" })
    h.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "ses_无" } })
    await tick()
    expect(h.out.filter((m) => m.result || m.error)).toHaveLength(0)
  })

  test("cancelled 的轮次不补兜底文本(qwen 会抛取消,不看文本)", async () => {
    const h = harness({ activeProject: "/proj", sessionIds: ["ses_a"] })
    h.send({ jsonrpc: "2.0", id: 100, method: "session/new", params: { cwd: "/p", mcpServers: [] } })
    await tick()
    const sid = h.responseTo(100).result.sessionId
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "x" }] } })
    await tick()
    h.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: sid } })
    await tick()
    expect(h.updates()).toHaveLength(0)
  })
})

describe("session/list — R9 语音查历史", () => {
  test("翻译成 ACP 形状", async () => {
    const h = harness({ activeProject: "/proj" })
    h.send({ jsonrpc: "2.0", id: 1, method: "session/list", params: {} })
    await tick()
    expect(h.responseTo(1).result.sessions[0]).toMatchObject({ sessionId: "ses_hist", title: "上次的活", cwd: "/proj" })
  })
})

describe("收尾", () => {
  test("dispose 把在途轮次收干净(进程退出时不留悬空请求)", async () => {
    const h = harness({ activeProject: "/proj", sessionIds: ["ses_a"] })
    h.send({ jsonrpc: "2.0", id: 100, method: "session/new", params: { cwd: "/p", mcpServers: [] } })
    await tick()
    const sid = h.responseTo(100).result.sessionId
    h.send({ jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "x" }] } })
    await tick()
    h.dispose()
    expect(h.responseTo(1).result).toEqual({ stopReason: "cancelled" })
  })

  test("qwen 发我们没实现的配置方法也不回 -32601 吓人", async () => {
    const h = harness()
    h.send({ jsonrpc: "2.0", id: 1, method: "session/setConfigOption", params: { sessionId: "x" } })
    await tick()
    expect(h.responseTo(1).result).toEqual({})
  })
})

describe("第三层模型:默认跟随绑定,配了才覆盖", () => {
  const tick2 = () => new Promise((r) => setTimeout(r, 0))

  // ★ 架构原则(user 2026-08-25):模型也走 DeskFox 通路 —— 用户界面上换了模型,
  //   下一次语音派活就跟着换。靠的是"查该项目最近实际用过的模型",
  //   **不能靠"不传 model"** —— 那会落到 sidecar 按模型名排序取的第一个,纯任意。
  test("没配 → 第三层跟随该项目最近使用的模型", async () => {
    const recent = { providerID: "claude-code", modelID: "opus" }
    const h = harness({ activeProject: "/proj", recentModel: recent })
    h.send({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/p", mcpServers: [] } })
    await tick2()
    const sid = h.responseTo(1).result.sessionId
    h.send({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "干活" }] } })
    await tick2()
    await tick2()
    expect(h.calls.prompts[0].model).toEqual(recent)
    // 查的是任务所在目录,不是 voice 目录
    expect(h.calls.recentModelQueries).toEqual(["/proj"])
  })

  test("该项目还没有会话记录 → 不指定模型,交给 sidecar 默认", async () => {
    const h = harness({ activeProject: "/proj", recentModel: null })
    h.send({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/p", mcpServers: [] } })
    await tick2()
    const sid = h.responseTo(1).result.sessionId
    h.send({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "干活" }] } })
    await tick2()
    await tick2()
    expect(h.calls.prompts[0].model).toBeNull()
  })

  test("coordinator 不查最近模型(它在独立目录,那里没有用户的模型历史)", async () => {
    const h = harness({ activeProject: "/proj", recentModel: { providerID: "x", modelID: "y" } })
    h.send({ jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/p", mcpServers: [QWEN_HTTP] } })
    await tick2()
    const sid = h.responseTo(1).result.sessionId
    h.send({ jsonrpc: "2.0", id: 2, method: "session/prompt", params: { sessionId: sid, prompt: [{ type: "text", text: "路由" }] } })
    await tick2()
    await tick2()
    expect(h.calls.recentModelQueries).toEqual([])
  })

  // ★ 真机 QA:全新 DB 下 opencode 默认档挑中 tongyi-intent-detect-v3(意图识别模型),
  //   任务 100% 失败;改共享 config 会波及用户实例,所以需要这个出口
  test("配了 → 第三层用指定模型,coordinator 仍用自己那档", async () => {
    const task = { providerID: "claude-code", modelID: "opus" }
    const coord = { providerID: "alibaba-cn", modelID: "qwen3.8-max" }
    const h = harness({ activeProject: "/proj", taskModel: task, coordinatorModel: coord })

    h.send({ jsonrpc: "2.0", id: 10, method: "session/new", params: { cwd: "/p", mcpServers: [QWEN_HTTP] } })
    await tick2()
    const c = h.responseTo(10).result.sessionId
    h.send({ jsonrpc: "2.0", id: 11, method: "session/prompt", params: { sessionId: c, prompt: [{ type: "text", text: "路由" }] } })
    await tick2()

    h.send({ jsonrpc: "2.0", id: 20, method: "session/new", params: { cwd: "/p", mcpServers: [] } })
    await tick2()
    const t = h.responseTo(20).result.sessionId
    h.send({ jsonrpc: "2.0", id: 21, method: "session/prompt", params: { sessionId: t, prompt: [{ type: "text", text: "干活" }] } })
    await tick2()

    expect(h.calls.prompts.find((p) => p.sessionID === c)!.model).toEqual(coord)
    // 显式配置优先于"最近使用"
    expect(h.calls.prompts.find((p) => p.sessionID === t)!.model).toEqual(task)
    // 第三层不该被塞路由引导,也不该被禁工具
    expect(h.calls.prompts.find((p) => p.sessionID === t)!.system).toBeUndefined()
    expect(h.calls.prompts.find((p) => p.sessionID === t)!.tools).toBeUndefined()
  })
})

describe("humanizeSidecarError — 播报得让人知道下一步干什么", () => {
  // ★ 真机 QA 用户实际听到的原文:「<400> InternalError.Algo.InvalidParameter:
  //   Range of input length should be [1, 13000]」—— 对着麦克风的人完全不知道该怎么办
  test("上下文超限 → 指向「换个上下文更大的模型」", () => {
    const out = humanizeSidecarError(
      '{"message":"<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 13000]"}',
    )
    expect(out).toContain("装不下")
    expect(out).toContain("换一个上下文更大的模型")
    expect(out).not.toContain("InvalidParameter")
  })

  test("认证 / 代理 / 限流 / 网络各有各的说法", () => {
    expect(humanizeSidecarError("401 unauthorized")).toContain("重新连接")
    expect(humanizeSidecarError("API Error: 403 Request not allowed")).toContain("代理")
    expect(humanizeSidecarError("429 rate limit exceeded")).toContain("限流")
    expect(humanizeSidecarError("fetch failed ECONNREFUSED")).toContain("网络")
  })

  test("认不出的错误保留原文但截短(播报念一长串堆栈没意义)", () => {
    expect(humanizeSidecarError("某个没见过的错误")).toBe("某个没见过的错误")
    const long = "x".repeat(400)
    expect(humanizeSidecarError(long).length).toBeLessThanOrEqual(161)
    expect(humanizeSidecarError(long).endsWith("…")).toBe(true)
  })

  test("空输入不抛", () => {
    expect(humanizeSidecarError("")).toBe("")
    expect(humanizeSidecarError(undefined as unknown as string)).toBe("")
  })
})
