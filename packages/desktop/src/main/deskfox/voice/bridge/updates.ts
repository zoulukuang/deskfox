// [fork-only] voice-acp-bridge — sidecar 事件流 → ACP session/update [feat: voice-acp-bridge] 2026-08-24
//
// 语音端的"实时监控任务进展"(1-spec R4)全靠这一层:sidecar 每写一个 part 就发一条事件,
// 桥把它翻成 qwen 认得的 `session/update`,qwen 再推成 `task.progress` 给 WebUI / 悬浮球。
//
// 三个必须处理对、否则会以隐蔽方式坏掉的差异:
//
//   ① **sidecar 的 text part 是累积值,qwen 的 chunk 是增量。**
//      `message.part.updated` 每次带的是**整段到目前为止的文本**(覆盖语义),而 qwen 把
//      `agent_message_chunk` 的 text **拼接**起来当最终结果(`acp-process-client.mjs:48-54`)。
//      原样转发的话 "你好" → "你好世界" 会被拼成 "你好你好世界"。所以按 partID 记住已发长度,只发新增。
//      (sidecar 也有 `message.part.delta` 增量事件,但它是 provider 可选的;
//       只认 part.updated 这条一定存在的路径,少一个不确定性。)
//
//   ② **必须只转 assistant 的 part。** 我们自己发进去的 prompt 也会产生 user part 事件,
//      转发出去就等于把用户的原话当成 agent 的回答累积进结果里 —— 结果是播报把问题又念一遍。
//      事件本身不带 role,靠 `message.updated` 建 messageID → role 的映射来过滤。
//
//   ③ **status 词表两边不一样**:sidecar `pending|running|completed|error`,
//      ACP `pending|in_progress|completed|failed`。翻错了 qwen 那边工具永远显示"进行中"。

import type { SidecarEvent } from "./sidecar"

/** 一条要发给 qwen 的 `session/update` 的 update 体(sessionId 由调用方补)。 */
export type AcpUpdate =
  | { readonly sessionUpdate: "agent_message_chunk"; readonly content: { type: "text"; text: string } }
  | {
      readonly sessionUpdate: "tool_call" | "tool_call_update"
      readonly toolCallId: string
      readonly title?: string
      readonly name?: string
      readonly status?: "pending" | "in_progress" | "completed" | "failed"
      readonly rawInput?: Record<string, unknown>
    }

/** 本轮 prompt 的终局信号。 */
export type TurnOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "none" }

const TOOL_STATUS: Record<string, "pending" | "in_progress" | "completed" | "failed"> = {
  pending: "pending",
  running: "in_progress",
  completed: "completed",
  error: "failed",
}

interface PartRecord {
  sent: number
}

export interface UpdateTranslator {
  /** 把一条 sidecar 事件翻成 0~n 条 ACP update */
  translate(event: SidecarEvent): readonly AcpUpdate[]
  /** 这条事件是不是本轮的终局(idle / error) */
  outcome(event: SidecarEvent): TurnOutcome
  /** 本轮累计发出的可见文本长度 —— 用来兜底 qwen 的「空响应」保护(见 bridge.ts) */
  emittedTextLength(): number
  /** 新一轮开始前清干净 */
  reset(): void
}

/**
 * 建一个只服务于**某一条 session** 的翻译器。事件流是按 directory 订阅的(会混进同目录别的
 * session),所以调用方要先按 `properties.sessionID` 过滤,再喂给对应的翻译器。
 */
export function createUpdateTranslator(sessionID: string): UpdateTranslator {
  const parts = new Map<string, PartRecord>()
  const roles = new Map<string, string>()
  const seenTools = new Set<string>()
  let emitted = 0

  const belongs = (props: Record<string, unknown> | undefined): boolean =>
    !!props && String(props.sessionID ?? "") === sessionID

  return {
    translate(event: SidecarEvent): readonly AcpUpdate[] {
      const props = event.properties
      if (!belongs(props)) return []

      // 记住每条消息是谁的 —— 过滤 user part 的唯一依据(见文件头②)
      if (event.type === "message.updated") {
        const info = props?.info as { id?: unknown; role?: unknown } | undefined
        if (info && typeof info.id === "string" && typeof info.role === "string") roles.set(info.id, info.role)
        return []
      }

      if (event.type !== "message.part.updated") return []
      const part = props?.part as
        | {
            id?: unknown
            type?: unknown
            text?: unknown
            messageID?: unknown
            synthetic?: unknown
            ignored?: unknown
            callID?: unknown
            tool?: unknown
            state?: { status?: unknown; input?: unknown; title?: unknown }
          }
        | undefined
      if (!part || typeof part.id !== "string") return []

      const messageID = typeof part.messageID === "string" ? part.messageID : ""
      // 只放行 assistant。role 还没到(part 事件偶尔先于 message.updated)时**保守放行**:
      // 漏一段 agent 文本会让结果不完整,而 user 文本重复的代价只是播报啰嗦一次。
      if (messageID && roles.get(messageID) === "user") return []

      if (part.type === "text") {
        if (part.synthetic === true || part.ignored === true) return []
        const full = typeof part.text === "string" ? part.text : ""
        const rec = parts.get(part.id) ?? { sent: 0 }
        // 文本被重写变短(压缩/重试)时不倒着发,直接对齐到新长度
        if (full.length < rec.sent) rec.sent = full.length
        if (full.length === rec.sent) {
          parts.set(part.id, rec)
          return []
        }
        const delta = full.slice(rec.sent)
        rec.sent = full.length
        parts.set(part.id, rec)
        emitted += delta.length
        return [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: delta } }]
      }

      if (part.type === "tool") {
        const callID = typeof part.callID === "string" && part.callID ? part.callID : part.id
        const tool = typeof part.tool === "string" ? part.tool : "tool"
        const state = part.state ?? {}
        const status = TOOL_STATUS[String(state.status ?? "")] ?? "in_progress"
        const title = typeof state.title === "string" && state.title ? state.title : tool
        const input = state.input && typeof state.input === "object" ? (state.input as Record<string, unknown>) : {}
        const first = !seenTools.has(callID)
        seenTools.add(callID)
        return [
          {
            // toolCallId 必须**跨事件稳定**,qwen 靠它做增量合并(`acp-backend-session-utils.mjs:113-116`);
            // 不稳定的话每次更新都会在进度里多出一条,20 条上限很快滚没
            sessionUpdate: first ? "tool_call" : "tool_call_update",
            toolCallId: callID,
            title,
            name: tool,
            status,
            rawInput: input,
          },
        ]
      }
      return []
    },

    outcome(event: SidecarEvent): TurnOutcome {
      const props = event.properties
      if (event.type === "session.idle" && belongs(props)) return { kind: "idle" }
      if (event.type === "session.error") {
        // session.error 的 sessionID 可能缺失(全局错误),那种也算本轮失败 —— 挂着不动更糟
        const sid = String(props?.sessionID ?? "")
        if (sid && sid !== sessionID) return { kind: "none" }
        const err = props?.error as { name?: unknown; data?: { message?: unknown } } | undefined
        const message =
          (typeof err?.data?.message === "string" && err.data.message) ||
          (typeof err?.name === "string" && err.name) ||
          "会话报错"
        return { kind: "error", message }
      }
      return { kind: "none" }
    },

    emittedTextLength(): number {
      return emitted
    },

    reset(): void {
      parts.clear()
      seenTools.clear()
      emitted = 0
    },
  }
}
