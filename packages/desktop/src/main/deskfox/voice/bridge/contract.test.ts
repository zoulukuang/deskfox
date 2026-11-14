// [fork-only] voice-acp-bridge — TC-U6 qwen 契约快照 [feat: voice-acp-bridge] 2026-08-24
//
// 1-spec §5 把「qwen 升级改动 acp backend 契约」列为中风险,缓解手段就是这组用例:
// **漂移时测试先红,而不是让语音在用户面前静默失灵。**
//
// 分两层:
//   ① 常量自洽(纯逻辑,到哪都能跑);
//   ② 对着**本机安装的 qwen 源码**做快照 —— 装了才跑,没装自动跳过,
//      免得没装语音依赖的机器(CI / 别人的开发机)红一片假警报。
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import {
  ACP_ENV_PREFIX,
  ACP_PROTOCOL_VERSION,
  CONSUMED_SESSION_UPDATES,
  ENVELOPE_BACKEND_INSTRUCTIONS_CLOSE,
  ENVELOPE_BACKEND_INSTRUCTIONS_OPEN,
  ENVELOPE_DELEGATION_RESULT_CLOSE,
  ENVELOPE_DELEGATION_RESULT_OPEN,
  ENV_ACP_COMMAND,
  ENV_ACP_WORKSPACE,
  QWEN_MCP_SERVER_NAME,
  QWEN_MCP_TOOL_NAMES,
  QWEN_MCP_TOOL_REQUIRED_ARGS,
  STOP_REASONS,
  assertContractSelfConsistent,
} from "./contract"

describe("常量自洽", () => {
  test("assertContractSelfConsistent 不抛", () => {
    expect(() => assertContractSelfConsistent()).not.toThrow()
  })

  test("协议版本必须是数字 1 —— 回错 qwen 直接杀进程树", () => {
    expect(ACP_PROTOCOL_VERSION).toBe(1)
  })

  test("五个派活工具齐全,且 session_start 收的是 prompt(不是 objective)", () => {
    expect(QWEN_MCP_TOOL_NAMES).toHaveLength(5)
    expect(QWEN_MCP_TOOL_NAMES).toContain("qwen_audio_agent_session_start")
    expect(QWEN_MCP_TOOL_REQUIRED_ARGS["qwen_audio_agent_session_start"]).toEqual(["prompt"])
    expect(QWEN_MCP_TOOL_REQUIRED_ARGS["qwen_audio_agent_session_send"]).toEqual(["session_id", "prompt"])
  })

  test("我们只发 qwen 真会消费的 sessionUpdate(非法值会被 zod 静默丢掉)", () => {
    expect([...CONSUMED_SESSION_UPDATES]).toEqual(["agent_message_chunk", "plan", "tool_call", "tool_call_update"])
  })

  test("stopReason 词表与 SDK 一致", () => {
    expect([...STOP_REASONS]).toEqual(["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"])
  })
})

// ───────────────────────── 对着本机 qwen 安装做快照 ─────────────────────────

/** 找 qwen-audio-agent 的包根;没装返回空串。 */
function findQwenRoot(): string {
  try {
    const bin = execFileSync("which", ["qwenaudio"], { encoding: "utf8" }).trim()
    if (!bin) return ""
    // `<root>/cli/bin/qwenaudio.mjs` → 上溯到 <root>
    let dir = dirname(resolve(execFileSync("realpath", [bin], { encoding: "utf8" }).trim()))
    for (let i = 0; i < 5; i++) {
      if (existsSync(join(dir, "shared", "backend-catalog.mjs"))) return dir
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return ""
  } catch {
    return ""
  }
}

const QWEN_ROOT = findQwenRoot()
const installed = QWEN_ROOT.length > 0
const readQwen = (rel: string) => readFileSync(join(QWEN_ROOT, rel), "utf8")

describe("qwen 安装快照(没装则跳过)", () => {
  test.skipIf(!installed)("通用 acp backend 的 env 白名单仍是 ACP_ 前缀", () => {
    const src = readQwen("shared/backend-catalog.mjs")
    // `'acp', { ... environment: { prefixes: ['ACP_'] ... } }`
    const acpBlock = src.slice(src.indexOf("['acp'"), src.indexOf("['acp'") + 1200)
    expect(acpBlock).toContain("prefixes: ['ACP_']")
    expect(ACP_ENV_PREFIX).toBe("ACP_")
  })

  test.skipIf(!installed)("acp backend 认的两个 env 名没变", () => {
    const src = readQwen("shared/backend-catalog.mjs")
    expect(src).toContain(`workspaceEnvironment: '${ENV_ACP_WORKSPACE}'`)
    expect(src).toContain(`commandEnvironment: '${ENV_ACP_COMMAND}'`)
  })

  test.skipIf(!installed)("通用 acp 仍然拒绝 full 权限模式 —— 必须用 native", () => {
    const src = readQwen("shared/backend-catalog.mjs")
    const acpBlock = src.slice(src.indexOf("['acp'"), src.indexOf("['acp'") + 1200)
    expect(acpBlock).toContain("supportsFullPermission: false")
  })

  test.skipIf(!installed)("MCP server 名与五个工具名逐一对得上", () => {
    const src = readQwen("server/src/agent/acp-session-tools.mjs")
    expect(src).toContain(`ACP_SESSION_TOOL_SERVER = '${QWEN_MCP_SERVER_NAME}'`)
    for (const name of QWEN_MCP_TOOL_NAMES) expect(src).toContain(name)
  })

  test.skipIf(!installed)("session_start 的入参仍是 prompt + 可选 title", () => {
    const src = readQwen("server/src/agent/acp-session-tools.mjs")
    // 定位到 registerTool 那处,而不是文件顶部的名字清单
    const at = src.search(/registerTool\(\s*'qwen_audio_agent_session_start'/)
    expect(at).toBeGreaterThan(-1)
    const head = src.slice(at, at + 900)
    expect(head).toContain("prompt:")
    expect(head).toContain("title:")
    // 若上游哪天改叫 objective,这条会红 —— 那正是我们要的信号
    expect(head).not.toContain("objective:")
  })

  test.skipIf(!installed)("两个信封标记字符串没变", () => {
    const src = readQwen("server/src/agent/acp-backend-adapter.mjs")
    expect(src).toContain(ENVELOPE_BACKEND_INSTRUCTIONS_OPEN)
    expect(src).toContain(ENVELOPE_BACKEND_INSTRUCTIONS_CLOSE)
    expect(src).toContain(ENVELOPE_DELEGATION_RESULT_OPEN)
    expect(src).toContain(ENVELOPE_DELEGATION_RESULT_CLOSE)
  })

  test.skipIf(!installed)("第三层 prompt 仍是 timeoutMs: 0(长任务不被掐的依据)", () => {
    const src = readQwen("server/src/agent/acp-backend-adapter.mjs")
    expect(src).toContain("timeoutMs: 0")
  })

  test.skipIf(!installed)("qwen 消费的四种 sessionUpdate 都还在", () => {
    const src = readQwen("server/src/agent/acp-backend-session-utils.mjs")
    for (const kind of CONSUMED_SESSION_UPDATES) expect(src).toContain(kind)
  })
})
