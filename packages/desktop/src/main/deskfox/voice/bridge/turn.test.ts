// [fork-only] voice-acp-bridge — TC-U5 三分法轮次判别 [feat: voice-acp-bridge] 2026-08-24
//
// 这组用例钉死的是**递归防护**。1-spec §7 TC-U5 明确要求:三类互斥、结果回流轮绝不触发派活路径,
// 并且判据认完整标签结构、不认子串(E6 实验里 mock 把信封尾巴传进第三层,暴露了这一点)。
import { describe, expect, test } from "bun:test"
import { classifyTurn, hasEnvelope, mayDelegate, promptText } from "./turn"
import {
  ENVELOPE_BACKEND_INSTRUCTIONS_CLOSE,
  ENVELOPE_BACKEND_INSTRUCTIONS_OPEN,
  ENVELOPE_DELEGATION_RESULT_CLOSE,
  ENVELOPE_DELEGATION_RESULT_OPEN,
} from "./contract"

/** 照 `acp-backend-adapter.mjs:949-954` 的拼法造一份请求信封。 */
const backendEnvelope = (body = "帮我分析一下沪深300的估值") =>
  [
    ENVELOPE_BACKEND_INSTRUCTIONS_OPEN,
    "You are the backend agent for qwen-audio-agent.",
    "The qwen_audio_agent MCP tools are the only interface for opening third-layer Sessions.",
    ENVELOPE_BACKEND_INSTRUCTIONS_CLOSE,
    "",
    body,
  ].join("\n")

/** 照 `acp-backend-adapter.mjs:1141-1155` 造一份结果回流轮 —— 注意它**同时**带着请求信封。 */
const delegationEnvelope = () =>
  [
    ENVELOPE_BACKEND_INSTRUCTIONS_OPEN,
    "You are the backend agent for qwen-audio-agent.",
    ENVELOPE_BACKEND_INSTRUCTIONS_CLOSE,
    "",
    ENVELOPE_DELEGATION_RESULT_OPEN,
    JSON.stringify({ request_id: "r1", delegation_id: "acp_run_x", result: "PE-TTM 12.8 倍" }, null, 2),
    ENVELOPE_DELEGATION_RESULT_CLOSE,
    "这是由 Gateway 验证并关联到当前请求的第三层 Session 最终结果。",
    "请只整理该可信结果并生成 presentation。",
  ].join("\n")

describe("classifyTurn — 三类互斥", () => {
  test("新请求路由轮:带请求信封、无回流结果", () => {
    const r = classifyTurn(backendEnvelope())
    expect(r.kind).toBe("coordinator")
    expect(mayDelegate(r.kind)).toBe(true)
  })

  test("第三层任务:什么信封都没有", () => {
    const r = classifyTurn("统计 voice-test 目录下有多少个 markdown 文件,写进 count.md")
    expect(r.kind).toBe("task")
    expect(mayDelegate(r.kind)).toBe(false)
  })

  // ★ 这条是 E4 那个递归的回归测试:收尾轮**两个信封都带**,只判 backend_instructions 会误判成新任务
  test("结果回流轮:两个信封都在时,必须判成 delegation-result 且不许派活", () => {
    const r = classifyTurn(delegationEnvelope())
    expect(r.kind).toBe("delegation-result")
    expect(mayDelegate(r.kind)).toBe(false)
  })

  test("空输入 / 非字符串一律当第三层任务(不会凭空获得派活权)", () => {
    for (const input of ["", "   ", undefined as unknown as string, null as unknown as string]) {
      const r = classifyTurn(input)
      expect(r.kind).toBe("task")
      expect(mayDelegate(r.kind)).toBe(false)
    }
  })
})

describe("认完整标签结构,不认子串", () => {
  test("任务文本里**提到**标记名 → 仍是第三层任务", () => {
    const quoted = [
      "把下面这段话整理成文档:",
      "「协调者收到的输入里会带 <qwen_audio_agent_backend_instructions> 这样的标记」",
      "另外说明 <qwen_audio_agent_delegation_result> 是结果回流用的。",
    ].join("\n")
    expect(classifyTurn(quoted).kind).toBe("task")
  })

  test("标记与正文同行 → 不算信封", () => {
    expect(classifyTurn(`前缀 ${ENVELOPE_BACKEND_INSTRUCTIONS_OPEN} 中间 ${ENVELOPE_BACKEND_INSTRUCTIONS_CLOSE}`).kind).toBe(
      "task",
    )
  })

  test("只有开标签、没有闭标签 → 不算信封(截断的输入不该改变语义)", () => {
    const truncated = [ENVELOPE_DELEGATION_RESULT_OPEN, '{"result":"半截"}'].join("\n")
    expect(classifyTurn(truncated).kind).toBe("task")
  })

  test("闭标签在开标签之前 → 不算信封", () => {
    const reversed = [ENVELOPE_BACKEND_INSTRUCTIONS_CLOSE, "正文", ENVELOPE_BACKEND_INSTRUCTIONS_OPEN].join("\n")
    expect(classifyTurn(reversed).kind).toBe("task")
  })

  test("标记独占一行但带缩进 / 尾随空格 → 仍算信封(qwen 的拼装容忍空白)", () => {
    const padded = [`  ${ENVELOPE_BACKEND_INSTRUCTIONS_OPEN}  `, "指令", `\t${ENVELOPE_BACKEND_INSTRUCTIONS_CLOSE}`].join(
      "\n",
    )
    expect(classifyTurn(padded).kind).toBe("coordinator")
  })
})

describe("hasEnvelope", () => {
  test("配对判定与顺序", () => {
    expect(hasEnvelope("<a>\nx\n</a>", "<a>", "</a>")).toBe(true)
    expect(hasEnvelope("<a>\nx", "<a>", "</a>")).toBe(false)
    expect(hasEnvelope("</a>\n<a>", "<a>", "</a>")).toBe(false)
    expect(hasEnvelope("", "<a>", "</a>")).toBe(false)
  })

  test("多组信封时取第一组开、其后任一闭", () => {
    expect(hasEnvelope(["<a>", "1", "</a>", "<a>", "2", "</a>"].join("\n"), "<a>", "</a>")).toBe(true)
  })
})

describe("promptText — 只取 text block", () => {
  test("拼接多个 text,忽略其它类型", () => {
    const blocks = [
      { type: "text", text: "第一段" },
      { type: "resource_link", uri: "file:///a.md", name: "a.md" },
      { type: "text", text: "第二段" },
      { type: "image", mimeType: "image/png", data: "xxx" },
    ]
    expect(promptText(blocks)).toBe("第一段\n第二段")
  })

  test("非数组 / 空数组 / 脏元素 → 空串,不抛", () => {
    expect(promptText(undefined)).toBe("")
    expect(promptText([])).toBe("")
    expect(promptText([null, 42, { type: "text" }, { text: "没 type" }])).toBe("")
  })
})
