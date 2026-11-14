// [fork-only] voice-acp-bridge — TC-U4 sidecar 事件流 → session/update [feat: voice-acp-bridge] 2026-08-24
//
// 这层最容易"看起来对、实际错":sidecar 的 text part 是**累积值**,qwen 的 chunk 是**增量**,
// 原样转发会把 "你好" → "你好世界" 拼成 "你好你好世界"。用例把这条钉死。
import { describe, expect, test } from "bun:test"
import { createUpdateTranslator } from "./updates"
import type { SidecarEvent } from "./sidecar"

const SID = "ses_target"

const textPart = (id: string, text: string, extra: Record<string, unknown> = {}): SidecarEvent => ({
  type: "message.part.updated",
  properties: { sessionID: SID, part: { id, type: "text", text, messageID: "msg_1", ...extra } },
})

const toolPart = (callID: string, status: string, extra: Record<string, unknown> = {}): SidecarEvent => ({
  type: "message.part.updated",
  properties: {
    sessionID: SID,
    part: {
      id: `prt_${callID}`,
      type: "tool",
      callID,
      tool: "bash",
      messageID: "msg_1",
      state: { status, input: { command: "ls -la" }, ...extra },
    },
  },
})

const assistantMessage = (id = "msg_1"): SidecarEvent => ({
  type: "message.updated",
  properties: { sessionID: SID, info: { id, role: "assistant" } },
})

const userMessage = (id: string): SidecarEvent => ({
  type: "message.updated",
  properties: { sessionID: SID, info: { id, role: "user" } },
})

describe("文本:累积值 → 增量", () => {
  test("同一个 part 连续更新时只发新增部分", () => {
    const t = createUpdateTranslator(SID)
    t.translate(assistantMessage())
    expect(t.translate(textPart("prt_1", "你好"))).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "你好" } },
    ])
    expect(t.translate(textPart("prt_1", "你好世界"))).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "世界" } },
    ])
    // 拼回去必须等于最终全文,不能多也不能少
    expect(t.emittedTextLength()).toBe("你好世界".length)
  })

  test("内容没变时不发空 chunk", () => {
    const t = createUpdateTranslator(SID)
    t.translate(assistantMessage())
    t.translate(textPart("prt_1", "同一段"))
    expect(t.translate(textPart("prt_1", "同一段"))).toEqual([])
  })

  test("多个 part 各自记各自的偏移", () => {
    const t = createUpdateTranslator(SID)
    t.translate(assistantMessage())
    t.translate(textPart("prt_1", "AA"))
    t.translate(textPart("prt_2", "BB"))
    expect(t.translate(textPart("prt_1", "AAcc"))).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "cc" } },
    ])
  })

  test("文本被重写变短(压缩/重试)→ 对齐到新长度,不倒着发", () => {
    const t = createUpdateTranslator(SID)
    t.translate(assistantMessage())
    t.translate(textPart("prt_1", "很长的一段话"))
    expect(t.translate(textPart("prt_1", "短"))).toEqual([])
    expect(t.translate(textPart("prt_1", "短了点"))).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "了点" } },
    ])
  })

  test("reset 后重新开始计增量", () => {
    const t = createUpdateTranslator(SID)
    t.translate(assistantMessage())
    t.translate(textPart("prt_1", "第一轮"))
    t.reset()
    expect(t.emittedTextLength()).toBe(0)
    expect(t.translate(textPart("prt_1", "第一轮"))).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "第一轮" } },
    ])
  })
})

describe("过滤:不该转发的一律不转", () => {
  // ★ 转了 user part 就等于把用户的原话当成 agent 的回答,播报会把问题又念一遍
  test("user 消息的 part 不转发", () => {
    const t = createUpdateTranslator(SID)
    t.translate(userMessage("msg_u"))
    expect(t.translate(textPart("prt_u", "帮我分析估值", { messageID: "msg_u" }))).toEqual([])
  })

  test("role 还没到时保守放行(漏 agent 文本的代价远大于播报啰嗦一次)", () => {
    const t = createUpdateTranslator(SID)
    expect(t.translate(textPart("prt_x", "先到的文本"))).toHaveLength(1)
  })

  test("synthetic / ignored 的文本不转发(那是系统注入的)", () => {
    const t = createUpdateTranslator(SID)
    t.translate(assistantMessage())
    expect(t.translate(textPart("prt_s", "系统提示", { synthetic: true }))).toEqual([])
    expect(t.translate(textPart("prt_i", "被忽略的", { ignored: true }))).toEqual([])
  })

  test("别的 session 的事件不转发(事件流按 directory 订阅,会混进同目录别人的)", () => {
    const t = createUpdateTranslator(SID)
    expect(
      t.translate({
        type: "message.part.updated",
        properties: { sessionID: "ses_别人", part: { id: "p", type: "text", text: "无关" } },
      }),
    ).toEqual([])
  })

  test("reasoning / 未知 part 类型不转发(思考过程不该进结果)", () => {
    const t = createUpdateTranslator(SID)
    t.translate(assistantMessage())
    expect(
      t.translate({
        type: "message.part.updated",
        properties: { sessionID: SID, part: { id: "p", type: "reasoning", text: "让我想想", messageID: "msg_1" } },
      }),
    ).toEqual([])
  })

  test("残缺事件不抛(part 缺 id / 无 properties)", () => {
    const t = createUpdateTranslator(SID)
    expect(t.translate({ type: "message.part.updated", properties: { sessionID: SID } })).toEqual([])
    expect(t.translate({ type: "message.part.updated" })).toEqual([])
    expect(t.translate({ type: "server.heartbeat", properties: {} })).toEqual([])
  })
})

describe("工具:首次 tool_call,之后 tool_call_update", () => {
  test("同一个 callID 的第二条起变 update,id 保持稳定", () => {
    const t = createUpdateTranslator(SID)
    t.translate(assistantMessage())
    const first = t.translate(toolPart("call_1", "running"))
    expect(first[0]).toMatchObject({ sessionUpdate: "tool_call", toolCallId: "call_1", name: "bash" })
    const second = t.translate(toolPart("call_1", "completed", { title: "列出目录" }))
    expect(second[0]).toMatchObject({ sessionUpdate: "tool_call_update", toolCallId: "call_1", status: "completed" })
  })

  test("status 词表翻译:running→in_progress,error→failed", () => {
    const t = createUpdateTranslator(SID)
    t.translate(assistantMessage())
    expect(t.translate(toolPart("c1", "pending"))[0]).toMatchObject({ status: "pending" })
    expect(t.translate(toolPart("c2", "running"))[0]).toMatchObject({ status: "in_progress" })
    expect(t.translate(toolPart("c3", "completed"))[0]).toMatchObject({ status: "completed" })
    expect(t.translate(toolPart("c4", "error"))[0]).toMatchObject({ status: "failed" })
  })

  test("未知 status 落到 in_progress,而不是丢掉这条工具", () => {
    const t = createUpdateTranslator(SID)
    expect(t.translate(toolPart("c5", "未来的新状态"))[0]).toMatchObject({ status: "in_progress" })
  })

  test("title 缺失时回落工具名;rawInput 透传给 qwen 做详情", () => {
    const t = createUpdateTranslator(SID)
    expect(t.translate(toolPart("c6", "running"))[0]).toMatchObject({
      title: "bash",
      rawInput: { command: "ls -la" },
    })
  })

  test("工具输出不计入文本长度(结果只该来自 agent_message_chunk)", () => {
    const t = createUpdateTranslator(SID)
    t.translate(toolPart("c7", "completed", { output: "一大堆输出" }))
    expect(t.emittedTextLength()).toBe(0)
  })
})

describe("终局信号", () => {
  test("session.idle 是完成", () => {
    const t = createUpdateTranslator(SID)
    expect(t.outcome({ type: "session.idle", properties: { sessionID: SID } })).toEqual({ kind: "idle" })
  })

  test("别人的 idle 不算我的", () => {
    const t = createUpdateTranslator(SID)
    expect(t.outcome({ type: "session.idle", properties: { sessionID: "ses_别人" } })).toEqual({ kind: "none" })
  })

  test("session.error 带出人话", () => {
    const t = createUpdateTranslator(SID)
    expect(
      t.outcome({
        type: "session.error",
        properties: { sessionID: SID, error: { name: "ProviderError", data: { message: "API 403" } } },
      }),
    ).toEqual({ kind: "error", message: "API 403" })
  })

  test("error 缺 message 时退到 name,再不行给兜底文案", () => {
    const t = createUpdateTranslator(SID)
    expect(t.outcome({ type: "session.error", properties: { sessionID: SID, error: { name: "Boom" } } })).toEqual({
      kind: "error",
      message: "Boom",
    })
    expect(t.outcome({ type: "session.error", properties: { sessionID: SID } })).toEqual({
      kind: "error",
      message: "会话报错",
    })
  })

  test("没带 sessionID 的全局 error 也算本轮失败 —— 挂着不动更糟", () => {
    const t = createUpdateTranslator(SID)
    expect(t.outcome({ type: "session.error", properties: { error: { data: { message: "全局炸了" } } } })).toEqual({
      kind: "error",
      message: "全局炸了",
    })
  })

  test("普通事件不是终局", () => {
    const t = createUpdateTranslator(SID)
    expect(t.outcome({ type: "message.part.updated", properties: { sessionID: SID } })).toEqual({ kind: "none" })
    expect(t.outcome({ type: "server.heartbeat" })).toEqual({ kind: "none" })
  })
})
