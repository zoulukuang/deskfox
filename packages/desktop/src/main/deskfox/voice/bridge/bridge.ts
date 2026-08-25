// [fork-only] voice-acp-bridge — 桥本体:六个 ACP 方法 ⇄ sidecar [feat: voice-acp-bridge] 2026-08-24
//
// 职责边界刻意窄(1-spec §2.2)。**做**:方法翻译、进度转发、MCP 注册、轮次判别。
// **不做**:意图分流、任务状态机、结果回流、播报排队、唤醒词、多任务登记、超时管理 ——
// 那些 qwen 全包了,自己再写一套就是路线 B(已否决,实测播报会打断且并发会截断)。
//
// 一轮派活的完整数据流(每一步都在 2026-08-24 的实验里跑通过):
//
//   用户说话 → realtime 判定复杂 → qwen 调 spawn_thinking
//     → gateway 把请求信封发给 coordinator session(桥 → sidecar 的 voice 目录)
//     → coordinator 模型调 MCP `qwen_audio_agent_session_start`
//     → gateway 回头对桥发 session/new + session/prompt(**第三层**)
//     → 桥在 sidecar 里建真 session(DeskFox 列表立刻可见)并把事件流转成 session/update
//     → 完成后桥回 end_turn → gateway 把结果包成 delegation_result 回灌 coordinator
//     → coordinator 整理 → announcement 通道播报(不打断)

import { ACP_PROTOCOL_VERSION, type StopReason } from "./contract"
import { buildCoordinatorPrompt } from "./coordinator-prompt"
import { planMcpRegistrations } from "./mcp"
import { createPeer, type JsonRpcId, type Peer } from "./protocol"
import { createSessionStore, type SessionRecord, type SessionStore } from "./sessions"
import type { SidecarClient, SidecarEvent } from "./sidecar"
import { classifyTurn, mayDelegate, promptText } from "./turn"
import { createUpdateTranslator } from "./updates"

/**
 * qwen 要求每轮 prompt **至少产出一条非空 `agent_message_chunk` 文本**,否则会判 502
 * 「ACP Session 未返回任何内容」,丢弃 coordinator session 并整轮重跑
 * (`acp-backend-adapter.mjs:1051-1061`、`:1192-1200`)。
 *
 * 正常情况 sidecar 一定有文本输出,但"只调了工具没说话"的轮次真实存在。那时补这一句,
 * 用重复一次播报的代价换掉一次无谓的重跑 —— 重跑意味着任务被完整执行两遍,代价大得多。
 */
const EMPTY_TURN_FALLBACK = "(本轮没有产生文本输出)"

/**
 * coordinator 禁用的工具。**这是「派活真的会发生」的结构性保证**,不是优化。
 *
 * 2026-08-24 真机 QA 实撞:说"统计文件数写进 count.md",coordinator 直接自己写了文件 ——
 * 第三层 session **一条都没建**,产物落在语音目录里而不是用户项目。
 * 根因不是 prompt 写得不够清楚,而是**它手里有更近的路**:coordinator session 是 sidecar 建的
 * 普通 session,自带 read/write/bash 全套工具,模型当然直接就干了。
 * (旧链路同病 —— voice-dispatch-minimal 那段「倾向于开新 session」的引导就是在跟它搏斗,
 *  1-spec §1.2 记的"判定阈值偏高、像样的活也留在 coordinator 里"是同一个现象。)
 *
 * 靠 prompt 说服模型"别做你能做的事"是不牢靠的;把路堵死才牢靠 —— 与"派活 MCP 只注册给
 * voice 目录"是同一个思路:**用结构保证行为,不用措辞**。
 *
 * 只禁写与执行,**保留只读**:一问一答就能完的轻量查询本来就该留在协调 session 里回答
 * (1-spec §3.1),禁掉只读会把那类请求也逼成派活,反而更差。
 */
const COORDINATOR_DENIED_TOOLS: Readonly<Record<string, boolean>> = {
  bash: false,
  edit: false,
  write: false,
  patch: false,
}

/** `provider/model` 的运行时形态(与 sidecar `PromptPayload.model` 同形) */
export interface ModelRef {
  readonly providerID: string
  readonly modelID: string
}

export interface BridgeDeps {
  readonly sidecar: SidecarClient
  readonly voiceDir: string
  readonly readActiveProject: () => string
  readonly write: (line: string) => void
  readonly log: (message: string) => void
  /** coordinator 的路由模型;null/省略 = 跟随 DeskFox 绑定的模型(见 startTurn 的注释) */
  readonly coordinatorModel?: ModelRef | null
  /** 第三层任务的模型;null/省略 = 跟随 DeskFox 绑定的模型(默认,R2/R3 同源) */
  readonly taskModel?: ModelRef | null
}

/**
 * 把 sidecar 的报错翻成用户听得懂、且**知道下一步该干什么**的话。
 *
 * 这些话会经 announcement 播报出去。2026-08-25 真机 QA 里用户听到的是
 * 「任务执行失败:<400> InternalError.Algo.InvalidParameter: Range of input length
 * should be [1, 13000]」—— 对着麦克风的人完全不知道这是什么、更不知道该怎么办。
 */
export function humanizeSidecarError(message: string): string {
  const raw = String(message ?? "")
  if (/Range of input length|context.{0,20}(length|window)|too many tokens|maximum context/i.test(raw)) {
    return "当前模型装不下这个任务的上下文。请在 DeskFox 设置里换一个上下文更大的模型再试。"
  }
  if (/\b401\b|unauthorized|invalid[_ ]api[_ ]key|authentication/i.test(raw)) {
    return "模型服务没通过认证。请在设置里重新连接对应的供应商。"
  }
  if (/\b403\b|Request not allowed/i.test(raw)) {
    return "模型服务拒绝了请求,常见原因是需要代理才能访问。"
  }
  if (/\b429\b|rate.?limit|quota/i.test(raw)) {
    return "模型服务限流了,稍等一会儿再试。"
  }
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|socket|network/i.test(raw)) {
    return "连不上模型服务,请检查网络。"
  }
  // 认不出的错误保留原文,但截短 —— 播报念一长串堆栈没有意义
  const brief = raw.replace(/\s+/g, " ").trim()
  return brief.length > 160 ? `${brief.slice(0, 160)}…` : brief
}

interface DirectoryStream {
  readonly stop: () => void
  readonly listeners: Set<(event: SidecarEvent) => void>
}

interface ActivePrompt {
  readonly record: SessionRecord
  readonly id: JsonRpcId | undefined
  settle(reason: StopReason, note: string): void
}

export interface Bridge {
  readonly peer: Peer
  readonly sessions: SessionStore
  /** 关掉所有事件订阅(进程退出时) */
  dispose(): void
}

export function createBridge(deps: BridgeDeps): Bridge {
  const peer = createPeer({ write: deps.write, log: deps.log })
  const streams = new Map<string, DirectoryStream>()
  const active = new Map<string, ActivePrompt>()
  /** 已经注册过的 MCP,签名 = `目录\0名字\0配置`,避免每轮 resume 都去重连一次 */
  const registeredMcp = new Set<string>()

  const sessions = createSessionStore({
    voiceDir: deps.voiceDir,
    readActiveProject: deps.readActiveProject,
    createSidecarSession: async (directory, coordinator) => {
      const created = await deps.sidecar.createSession(directory, {
        // coordinator 就是「语音沟通」记录本身(1-spec §3.1 第二件事:user 拍板的对话留痕)。
        // 给个固定标题,免得标题模型拿一堆路由指令去生成一个莫名其妙的名字。
        ...(coordinator ? { title: "语音沟通" } : {}),
      })
      if (!created?.id) throw new Error("sidecar 建 session 没有返回 id")
      return created.id
    },
    log: deps.log,
  })

  // ── 事件流:按 directory 订阅一次,同目录的多条 session 共用 ──────────────────────
  const ensureStream = (directory: string): DirectoryStream => {
    const known = streams.get(directory)
    if (known) return known
    const listeners = new Set<(event: SidecarEvent) => void>()
    const stop = deps.sidecar.subscribeEvents(
      directory,
      (event) => {
        for (const fn of [...listeners]) {
          try {
            fn(event)
          } catch (e) {
            deps.log(`事件处理抛错(已吞):${String((e as { message?: string })?.message ?? e)}`)
          }
        }
      },
      (reason) => {
        // 断流不是致命的:sidecar 还在跑,任务照常完成、列表照常可见,只是进度和完成信号丢了。
        // 把在途的 prompt 收干净(绝不能悬着,见 protocol.ts 文件头②),下一轮 prompt 会重新订阅。
        deps.log(`事件流断开(${directory}):${reason}`)
        streams.delete(directory)
        for (const [, p] of active) {
          if (p.record.directory === directory) p.settle("end_turn", `事件流断开:${reason}`)
        }
      },
    )
    const stream = { stop, listeners }
    streams.set(directory, stream)
    return stream
  }

  // ── MCP 注册:只往 coordinator 的目录注册,理由见 mcp.ts 文件头 ────────────────────
  const registerMcp = async (record: SessionRecord, mcpServers: unknown): Promise<void> => {
    const plan = planMcpRegistrations(mcpServers, record.coordinator)
    for (const skip of plan.skipped) deps.log(`跳过 MCP ${skip.name}:${skip.reason}`)
    for (const item of plan.register) {
      const signature = `${record.directory} ${item.name} ${JSON.stringify(item.config)}`
      if (registeredMcp.has(signature)) continue
      try {
        await deps.sidecar.addMcp(record.directory, item.name, item.config)
        registeredMcp.add(signature)
        deps.log(`已注册 MCP ${item.name} → ${record.directory}`)
      } catch (e) {
        // 注册失败 = coordinator 拿不到派活工具,语音只能自己答不能派活。报出来但不阻断:
        // 能答一句总比整个语音起不来强。
        deps.log(`注册 MCP ${item.name} 失败:${String((e as { message?: string })?.message ?? e)}`)
      }
    }
  }

  // ── ACP 方法 ───────────────────────────────────────────────────────────────────
  peer.on("initialize", () => ({
    // 严格 1,否则 qwen 直接判「协议版本不兼容」并杀进程树(`acp-process-client.mjs:233-242`)
    protocolVersion: ACP_PROTOCOL_VERSION,
    agentInfo: { name: "deskfox-voice-bridge", version: "1.0.0" },
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: {
        // 声明 resume:不声明的话 qwen 无法续接 coordinator(每轮都新建),
        // 而且第三层的 `session_send`(继续之前的任务)会直接失败
        resume: {},
        // 声明 list:R9「语音查看 session 历史」靠它,不声明则 sessions_list 恒为空
        list: {},
      },
      // 不声明 image/audio/embeddedContext:声明了就要真能处理带附件的 prompt,
      // 而语音链路的输入本来就是纯文本。声明假的能力会让客户端把附件发过来然后我们丢掉。
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
    },
    authMethods: [],
  }))

  peer.on("session/new", async (params) => {
    const p = (params ?? {}) as { cwd?: unknown; mcpServers?: unknown }
    const record = await sessions.create(p)
    await registerMcp(record, p.mcpServers)
    ensureStream(record.directory)
    return { sessionId: record.acpId }
  })

  const resumeHandler = async (params: unknown) => {
    const p = (params ?? {}) as { sessionId?: unknown; cwd?: unknown; mcpServers?: unknown }
    const record = await sessions.resume(p)
    await registerMcp(record, p.mcpServers)
    ensureStream(record.directory)
    // ⚠️ resume/load 的 result 里**没有** sessionId 字段(SDK `zResumeSessionResponse`),
    // qwen 沿用它自己传进来的那个 —— 这正是「透明换新」成立的原因
    return {}
  }
  peer.on("session/resume", resumeHandler)
  peer.on("session/load", resumeHandler)

  peer.on("session/list", async () => {
    // R9:语音问"我之前做过什么"。列 coordinator 目录之外的东西没意义(那是用户项目,
    // 有独立入口),这里给的是当前活跃项目的历史 —— 与用户在 DeskFox 里看到的一致。
    const directory = deps.readActiveProject() || deps.voiceDir
    try {
      const list = await deps.sidecar.listSessions(directory)
      return {
        sessions: list.map((s) => ({
          sessionId: s.id,
          cwd: s.directory ?? directory,
          title: s.title ?? "",
          updatedAt: s.time?.updated ? new Date(s.time.updated).toISOString() : undefined,
        })),
      }
    } catch (e) {
      deps.log(`session/list 失败:${String((e as { message?: string })?.message ?? e)}`)
      return { sessions: [] }
    }
  })

  peer.on("session/prompt", (params, ctx) => {
    const p = (params ?? {}) as { sessionId?: unknown; prompt?: unknown }
    const acpId = String(p.sessionId ?? "")
    const record = sessions.get(acpId)
    if (!record) {
      peer.respondError(ctx.id, `未知的 sessionId:${acpId}(session/new 没走成?)`)
      return undefined
    }
    if (active.has(acpId)) {
      // qwen 侧本来就不允许同 session 并发 prompt;真撞上说明状态错乱,明确报错好过悄悄错配
      peer.respondError(ctx.id, `session ${acpId} 上已有进行中的轮次`)
      return undefined
    }

    const text = promptText(p.prompt)
    const turn = classifyTurn(text)
    deps.log(
      `prompt [${acpId}] ${text.length} 字 → ${turn.kind}(${turn.reason});` +
        `允许派活=${mayDelegate(turn.kind) ? "是" : "否"}`,
    )

    // coordinator 用自己那档(见 startTurn);第三层要先问一下"用户现在在用什么模型"
    if (record.coordinator) {
      startTurn(record, ctx.id, text, null)
    } else {
      void resolveTaskModel(record.directory)
        .then((model) => startTurn(record, ctx.id, text, model))
        .catch((e) => peer.respondError(ctx.id, `选模型失败:${String((e as { message?: string })?.message ?? e)}`))
    }
    // 返回 undefined = 响应稍后自己发。第三层可能挂好几分钟(qwen 对它设 timeoutMs:0 不超时)
    return undefined
  })

  peer.on("session/cancel", (params) => {
    const acpId = String((params as { sessionId?: unknown })?.sessionId ?? "")
    const running = active.get(acpId)
    const record = running?.record ?? sessions.get(acpId)
    if (record) {
      void deps.sidecar
        .abort(record.directory, record.sidecarId)
        .catch((e) => deps.log(`abort 失败:${String((e as { message?: string })?.message ?? e)}`))
    }
    // 收到 cancel 必须**尽快**结束在途 prompt 并回响应,否则那条 session 永久锁死
    running?.settle("cancelled", "收到 session/cancel")
    return undefined
  })

  peer.on("session/close", (params) => {
    const acpId = String((params as { sessionId?: unknown })?.sessionId ?? "")
    active.get(acpId)?.settle("cancelled", "session/close")
    return {}
  })

  // qwen 在设了 ACP_COORDINATOR_AGENT 时会发;我们不设,但收到也别回 -32601 吓人
  peer.on("session/setConfigOption", () => ({}))
  peer.on("session/set_config_option", () => ({}))

  // ── 一轮 prompt 的生命周期 ──────────────────────────────────────────────────────
  /**
   * 第三层该用哪个模型。**这是「模型也走 DeskFox 通路」的落点**(user 2026-08-25 定的原则)。
   *
   * 顺序:显式配置 > 用户在该项目最近实际用的 > 不指定(交给 sidecar 默认)。
   * 中间那条是关键 —— 用户在界面上换模型,下一次语音派活就跟着换,不需要重启语音、
   * 也不需要在语音链路里另配一套。
   *
   * 最后那条兜底会落到 `defaultModelIDs`(按模型名排序取第一个,纯任意),
   * 只在"全新项目 + 从没建过会话"时才可能走到;那种情况下用户自己手敲也会撞上同一个默认。
   */
  async function resolveTaskModel(directory: string): Promise<ModelRef | null> {
    if (deps.taskModel) return deps.taskModel
    const recent = await deps.sidecar.recentModel(directory)
    if (recent) {
      deps.log(`第三层跟随该项目最近使用的模型:${recent.providerID}/${recent.modelID}`)
      return recent
    }
    deps.log(`该项目还没有会话记录,第三层不指定模型(交给 sidecar 默认档)`)
    return null
  }

  function startTurn(record: SessionRecord, id: JsonRpcId | undefined, text: string, taskModel: ModelRef | null): void {
    const translator = createUpdateTranslator(record.sidecarId)
    const stream = ensureStream(record.directory)
    let done = false
    /** 本轮有没有往 qwen 发过可见文本 —— 决定要不要补兜底,见 EMPTY_TURN_FALLBACK */
    let textSent = false

    const emitText = (text: string): void => {
      textSent = true
      peer.notify("session/update", {
        sessionId: record.acpId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
      })
    }

    const finish = (reason: StopReason, note: string): void => {
      if (done) return
      done = true
      stream.listeners.delete(onEvent)
      active.delete(record.acpId)
      if (reason !== "cancelled" && !textSent && translator.emittedTextLength() === 0) {
        deps.log("本轮没有可见文本输出,补一句兜底,避免 qwen 判空响应并整轮重跑")
        emitText(EMPTY_TURN_FALLBACK)
      }
      deps.log(`轮次结束 [${record.acpId}] ${reason}:${note}`)
      peer.respond(id, { stopReason: reason })
    }

    const onEvent = (event: SidecarEvent): void => {
      if (done) return
      for (const update of translator.translate(event)) {
        // sessionId 用 **ACP 侧的 id**:qwen 只认它,内部换过 sidecar session 它并不知情
        peer.notify("session/update", { sessionId: record.acpId, update })
      }
      const outcome = translator.outcome(event)
      if (outcome.kind === "idle") {
        finish("end_turn", "sidecar 报告 session.idle")
      } else if (outcome.kind === "error") {
        // 失败也要**说出来**。回 JSON-RPC error 的话 qwen 只会在日志里留一行,用户对着麦克风
        // 等到的是一片安静;发成正文再 end_turn,失败原因会走 announcement 播报出来。
        // 措辞经 humanizeSidecarError 翻成人话 —— 播报一句 `<400> InternalError.Algo…`
        // 等于没说(2026-08-25 真机 QA 用户实际听到的就是那个)。
        emitText(`任务执行失败:${humanizeSidecarError(outcome.message)}`)
        deps.log(`原始错误:${outcome.message}`)
        finish("end_turn", `sidecar 报错:${outcome.message}`)
      }
    }

    active.set(record.acpId, {
      record,
      id,
      settle: (reason, note) => finish(reason, note),
    })
    stream.listeners.add(onEvent)

    // 路由引导只发给 coordinator。第三层是执行者,给它看"要不要派活"的判据纯属干扰
    // (旧方案走全局 instructions,不得不写一段「先判断你是谁」来自我否定,见 coordinator-prompt.ts)
    //
    // 模型同理只对 coordinator 指定:它每轮要吞 ~4.6k 字的信封,小上下文模型直接 400
    // (2026-08-24 真机 QA 实撞)。第三层不指定 → 跟随 DeskFox 绑定的模型,
    // 「与手敲 session 无差别」因此不受影响。
    const options = record.coordinator
      ? {
          // 每轮现算:用户可能刚切了项目,而 coordinator 自己的 cwd 是 voice 目录、
          // 对"当前项目在哪"一无所知(不告诉它就会把自己那个目录写进任务文本)
          system: buildCoordinatorPrompt(deps.readActiveProject()),
          model: deps.coordinatorModel ?? null,
          // 见 COORDINATOR_DENIED_TOOLS:堵死"自己把活干了"这条路,派活才会真的发生
          tools: COORDINATOR_DENIED_TOOLS as Record<string, boolean>,
        }
      : // 第三层跟随**用户在 DeskFox 里实际用的模型**(见 resolveTaskModel)。
        // 注意不能靠"不传 model" —— 那会落到 sidecar 按模型名排序取的第一个,纯任意。
        { model: taskModel }

    void deps.sidecar.promptAsync(record.directory, record.sidecarId, [{ type: "text", text }], options).catch((e) => {
      const message = String((e as { message?: string })?.message ?? e)
      deps.log(`发 prompt 失败:${message}`)
      if (!done) {
        done = true
        stream.listeners.delete(onEvent)
        active.delete(record.acpId)
        peer.respondError(id, `DeskFox 没能接下这个任务:${message}`)
      }
    })
  }

  return {
    peer,
    sessions,
    dispose(): void {
      for (const [, p] of active) p.settle("cancelled", "桥退出")
      for (const [, s] of streams) s.stop()
      streams.clear()
    },
  }
}
