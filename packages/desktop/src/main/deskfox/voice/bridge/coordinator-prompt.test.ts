// [fork-only] voice-acp-bridge — coordinator 路由引导 [feat: voice-acp-bridge] 2026-08-25
//
// 这组用例守的是 2026-08-25 真机 QA 的两个教训:
//   ① 模型认不出双前缀的派活工具名 → 必须把**真名**写进 prompt,不让它猜;
//   ② 工具被拒后模型会编造"已完成" → prompt 必须明令禁止。
import { describe, expect, test } from "bun:test"
import { COORDINATOR_ROUTING_PROMPT, buildCoordinatorPrompt } from "./coordinator-prompt"
import { QWEN_MCP_SERVER_NAME } from "./contract"

describe("COORDINATOR_ROUTING_PROMPT", () => {
  // ★ sidecar 会加一层 server 名前缀,而 qwen 的工具名本身就带 qwen_audio_agent_
  test("写的是 sidecar 侧的真实工具名(双前缀),不是 qwen 信封里那个短名", () => {
    expect(COORDINATOR_ROUTING_PROMPT).toContain(`${QWEN_MCP_SERVER_NAME}_${QWEN_MCP_SERVER_NAME}_session_start`)
    expect(COORDINATOR_ROUTING_PROMPT).toContain(`${QWEN_MCP_SERVER_NAME}_${QWEN_MCP_SERVER_NAME}_session_send`)
    expect(COORDINATOR_ROUTING_PROMPT).toContain(`${QWEN_MCP_SERVER_NAME}_${QWEN_MCP_SERVER_NAME}_sessions_list`)
  })

  test("说清工具被禁是分工而不是故障,免得模型以为要重试", () => {
    expect(COORDINATOR_ROUTING_PROMPT).toContain("unavailable tool")
    expect(COORDINATOR_ROUTING_PROMPT).toContain("不是故障")
  })

  // ★ 真机实撞:write 被拒后模型回了"结果已经写进 count.md",而根本没写
  test("明令禁止编造完成(语音场景用户没法当场核对)", () => {
    expect(COORDINATOR_ROUTING_PROMPT).toContain("不要假装做完了")
    expect(COORDINATOR_ROUTING_PROMPT).toContain("已经写好了")
  })

  test("保留原有的路由阈值引导(倾向于开新 session)", () => {
    expect(COORDINATOR_ROUTING_PROMPT).toContain("倾向于开")
    expect(COORDINATOR_ROUTING_PROMPT).toContain("拿不准就开新的")
  })

  test("交代派出去的任务文本要自带上下文(接活的是全新会话)", () => {
    expect(COORDINATOR_ROUTING_PROMPT).toContain("看不到你和用户说过的任何话")
  })

  test("**不含**旧方案那段「先判断你是谁」的自我否定条款", () => {
    // 新架构里第三层结构上拿不到派活工具,不需要靠 prompt 说服模型别做做不到的事
    expect(COORDINATOR_ROUTING_PROMPT).not.toContain("先判断你是谁")
  })

  test("标签闭合(拼进 system prompt 后不会污染后文)", () => {
    expect(COORDINATOR_ROUTING_PROMPT.startsWith("<deskfox-voice-routing>")).toBe(true)
    expect(COORDINATOR_ROUTING_PROMPT.trimEnd().endsWith("</deskfox-voice-routing>")).toBe(true)
  })
})

// coordinator 的 cwd 是 voice 独立目录(递归防护的代价),它对"用户项目在哪"一无所知。
// 真机实撞:它把自己那个目录写进任务文本,第三层照着绝对路径写,产物落在语音工作区。
describe("工作目录说明", () => {
  test("知道当前项目时写进 prompt,并明令不要写绝对路径", () => {
    const p = buildCoordinatorPrompt("/Users/u/my-project")
    expect(p).toContain("/Users/u/my-project")
    expect(p).toContain("不要在任务里写绝对路径")
    expect(p).toContain("你自己所在的目录**不是**用户的项目")
  })

  test("不知道当前项目时,仍然明令不要写绝对路径", () => {
    const p = buildCoordinatorPrompt("")
    expect(p).toContain("不要在任务里写任何绝对路径")
    expect(p).not.toContain("用户当前打开的项目是")
  })

  test("默认导出 = 无项目上下文的形态,且结构完整", () => {
    expect(COORDINATOR_ROUTING_PROMPT).toBe(buildCoordinatorPrompt(""))
    expect(COORDINATOR_ROUTING_PROMPT.trimEnd().endsWith("</deskfox-voice-routing>")).toBe(true)
  })

  test("换项目 → prompt 跟着换(每轮现算,不缓存)", () => {
    expect(buildCoordinatorPrompt("/a")).not.toBe(buildCoordinatorPrompt("/b"))
  })
})
