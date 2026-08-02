// [feat: imbot-agent-schema-upgrade] REQ-094 T1-T6
import { describe, expect, test } from "bun:test"
import { IMBOT_SCHEMA_VERSION, imbotAgentSpec, injectImbotAgent } from "./imbot-agent"

function imbotOf(config: Record<string, unknown>): Record<string, unknown> {
  return (config.agent as Record<string, unknown>).imbot as Record<string, unknown>
}

describe("injectImbotAgent(REQ-094 _schemaVersion 升级)", () => {
  test("T1: 无 imbot → 注入完整 spec 含 _schemaVersion", () => {
    const config: Record<string, unknown> = {}
    expect(injectImbotAgent(config)).toBe(true)
    const imbot = imbotOf(config)
    expect(imbot._schemaVersion).toBe(IMBOT_SCHEMA_VERSION)
    expect(imbot.permission).toEqual(imbotAgentSpec().permission)
  })

  test("T2: 旧残留(无 _schemaVersion)→ 升级,permission/description 覆盖", () => {
    const config: Record<string, unknown> = {
      agent: {
        imbot: {
          description: "老 V2 描述",
          permission: { read: { "*": "ask" }, bash: { "*": "ask" } },
        },
      },
    }
    expect(injectImbotAgent(config)).toBe(true)
    const imbot = imbotOf(config)
    expect(imbot._schemaVersion).toBe(IMBOT_SCHEMA_VERSION)
    expect(imbot.description).toBe(imbotAgentSpec().description)
    expect(imbot.permission).toEqual(imbotAgentSpec().permission)
  })

  test("T3: 升级时用户自增键(model/prompt/tools)原样保留", () => {
    const config: Record<string, unknown> = {
      agent: {
        imbot: {
          _schemaVersion: 1,
          description: "旧描述",
          permission: { bash: { "*": "deny" } },
          model: "anthropic/claude-fable-5",
          prompt: "自定义 prompt",
          tools: { webfetch: false },
        },
      },
    }
    expect(injectImbotAgent(config)).toBe(true)
    const imbot = imbotOf(config)
    expect(imbot.model).toBe("anthropic/claude-fable-5")
    expect(imbot.prompt).toBe("自定义 prompt")
    expect(imbot.tools).toEqual({ webfetch: false })
    expect(imbot.permission).toEqual(imbotAgentSpec().permission)
  })

  test("T4: _schemaVersion 等于当前 → skip,对象零改动", () => {
    const before = { ...imbotAgentSpec(), model: "user/model" }
    const config: Record<string, unknown> = { agent: { imbot: { ...before } } }
    expect(injectImbotAgent(config)).toBe(false)
    expect(imbotOf(config)).toEqual(before)
  })

  test("T5: _schemaVersion 高于当前(降级安装)→ 不动", () => {
    const config: Record<string, unknown> = {
      agent: { imbot: { _schemaVersion: IMBOT_SCHEMA_VERSION + 1, permission: { bash: { "*": "deny" } } } },
    }
    expect(injectImbotAgent(config)).toBe(false)
    expect((imbotOf(config).permission as Record<string, unknown>).bash).toEqual({ "*": "deny" })
  })

  test("T6: imbot 值形状异常(字符串/数组)→ 不动", () => {
    const asString: Record<string, unknown> = { agent: { imbot: "broken" } }
    expect(injectImbotAgent(asString)).toBe(false)
    expect((asString.agent as Record<string, unknown>).imbot).toBe("broken")

    const asArray: Record<string, unknown> = { agent: { imbot: [1, 2] } }
    expect(injectImbotAgent(asArray)).toBe(false)
    expect((asArray.agent as Record<string, unknown>).imbot).toEqual([1, 2])
  })
})
