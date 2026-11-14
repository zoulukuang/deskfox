// [fork-only] voice-acp-bridge — TC-U8 MCP 描述符翻译与注册策略 [feat: voice-acp-bridge] 2026-08-24
//
// 两件事:① qwen 的 http+Bearer server 要正确翻成 sidecar 的 remote 配置;
// ② **只注册给 coordinator 目录** —— 这是递归防护(1-spec §3.1)在代码里的落点,
//    也顺带挡住"用户打开自己项目时莫名多出 qwen 工具"这个副作用。
import { describe, expect, test } from "bun:test"
import { looksLikeCoordinator, pairsToRecord, planMcpRegistrations, translateMcpServer } from "./mcp"

/** 照 `acp-session-tools.mjs:184-192` 造的真实形态 */
const QWEN_HTTP = {
  type: "http",
  name: "qwen_audio_agent",
  url: "http://127.0.0.1:51234/mcp",
  headers: [{ name: "Authorization", value: "Bearer 6f1c-uuid" }],
}

/** 照 `builtin-mcp.mjs:60-72`:stdio 形态**没有 type 字段** */
const BUILTIN_STDIO = {
  name: "open-computer-use",
  command: "/usr/bin/node",
  args: ["/opt/ocu/bin", "mcp"],
  env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
}

describe("translateMcpServer", () => {
  test("http + Bearer → sidecar remote,headers 数组转对象", () => {
    expect(translateMcpServer(QWEN_HTTP)).toEqual({
      name: "qwen_audio_agent",
      config: {
        type: "remote",
        url: "http://127.0.0.1:51234/mcp",
        headers: { Authorization: "Bearer 6f1c-uuid" },
        enabled: true,
      },
    })
  })

  test("stdio(无 type)→ sidecar local,command 与 args 合成一个数组", () => {
    expect(translateMcpServer(BUILTIN_STDIO)).toEqual({
      name: "open-computer-use",
      config: {
        type: "local",
        command: ["/usr/bin/node", "/opt/ocu/bin", "mcp"],
        environment: { ELECTRON_RUN_AS_NODE: "1" },
        enabled: true,
      },
    })
  })

  test("没 headers / 没 env 时不塞空对象", () => {
    const r = translateMcpServer({ type: "http", name: "x", url: "http://a/mcp" })
    expect(r?.config).toEqual({ type: "remote", url: "http://a/mcp", enabled: true })
  })

  test("认不出的形态一律 null —— 宁可少注册,也不拿错配置去污染用户目录", () => {
    expect(translateMcpServer(null)).toBeNull()
    expect(translateMcpServer({ name: "无传输方式" })).toBeNull()
    expect(translateMcpServer({ type: "http", name: "缺 url" })).toBeNull()
    expect(translateMcpServer({ type: "grpc", name: "未来的新传输", url: "x" })).toBeNull()
    expect(translateMcpServer({ command: "/bin/x" })).toBeNull() // 无名字
  })
})

describe("pairsToRecord", () => {
  test("正常转换 + 脏元素跳过 + 重名后来者胜", () => {
    expect(
      pairsToRecord([
        { name: "A", value: "1" },
        null,
        { name: "", value: "空名" },
        { name: "B", value: 42 },
        { name: "A", value: "2" },
      ]),
    ).toEqual({ A: "2" })
  })

  test("非数组 → 空对象", () => {
    expect(pairsToRecord(undefined)).toEqual({})
    expect(pairsToRecord("nope")).toEqual({})
  })
})

describe("looksLikeCoordinator — session/new 阶段的结构性判据", () => {
  test("带 qwen_audio_agent 就是 coordinator", () => {
    expect(looksLikeCoordinator([QWEN_HTTP, BUILTIN_STDIO])).toBe(true)
  })

  test("只有 builtin(第三层的形态)不是", () => {
    expect(looksLikeCoordinator([BUILTIN_STDIO])).toBe(false)
    expect(looksLikeCoordinator([])).toBe(false)
    expect(looksLikeCoordinator(undefined)).toBe(false)
  })
})

describe("planMcpRegistrations — 注册策略", () => {
  test("coordinator:只注册派活工具,builtin 被跳过并留下理由", () => {
    const plan = planMcpRegistrations([QWEN_HTTP, BUILTIN_STDIO], true)
    expect(plan.register).toHaveLength(1)
    expect(plan.register[0].name).toBe("qwen_audio_agent")
    expect(plan.skipped.map((s) => s.name)).toEqual(["open-computer-use"])
    expect(plan.skipped[0].reason).toContain("自带全套工具")
  })

  // ★ 递归防护的代码级落点:第三层拿不到 session_start
  test("非 coordinator:一个都不注册,理由点明会波及用户自己的会话", () => {
    const plan = planMcpRegistrations([QWEN_HTTP, BUILTIN_STDIO], false)
    expect(plan.register).toHaveLength(0)
    expect(plan.skipped).toHaveLength(2)
    for (const s of plan.skipped) expect(s.reason).toContain("第三层")
  })

  test("认不出的描述符进 skipped 而不是丢掉(排查时看得见)", () => {
    const plan = planMcpRegistrations([{ name: "怪东西" }], true)
    expect(plan.register).toHaveLength(0)
    expect(plan.skipped[0]).toEqual({ name: "怪东西", reason: "认不出的 MCP 传输形态,跳过" })
  })

  test("空输入不抛", () => {
    expect(planMcpRegistrations(undefined, true)).toEqual({ register: [], skipped: [] })
  })
})
