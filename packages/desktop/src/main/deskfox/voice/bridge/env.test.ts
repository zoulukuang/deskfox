// [fork-only] voice-acp-bridge — TC-U7 桥的启动配置契约 [feat: voice-acp-bridge] 2026-08-24
//
// 要求(1-spec §7):缺 ACP_DESKFOX_SERVER_URL / AUTH 时**启动失败且报人话**,不静默跑偏。
// 静默跑偏的表现是用户说完话、等半天、什么都没发生 —— 那种故障最难查。
import { describe, expect, test } from "bun:test"
import { basicAuthHeader, parseModelRef, readBridgeConfig } from "./env"

const full = {
  ACP_DESKFOX_SERVER_URL: "http://127.0.0.1:53412",
  ACP_DESKFOX_SERVER_AUTH: "Basic b3BlbmNvZGU6cHc=",
  ACP_DESKFOX_VOICE_DIR: "/home/u/.deskfox/voice",
}

describe("readBridgeConfig", () => {
  test("齐全时解析出全部字段", () => {
    const c = readBridgeConfig({
      ...full,
      ACP_DESKFOX_ACTIVE_PROJECT_FILE: "/tmp/active.json",
      ACP_DESKFOX_LOG_FILE: "/tmp/bridge.log",
    })
    expect(c.serverUrl).toBe("http://127.0.0.1:53412")
    expect(c.authorization).toBe("Basic b3BlbmNvZGU6cHc=")
    expect(c.voiceDir).toBe("/home/u/.deskfox/voice")
    expect(c.activeProjectFile).toBe("/tmp/active.json")
    expect(c.logFile).toBe("/tmp/bridge.log")
  })

  test("可选项缺失不报错(跟随项目退化成用 qwen 给的 cwd,日志只进 stderr)", () => {
    const c = readBridgeConfig(full)
    expect(c.activeProjectFile).toBe("")
    expect(c.logFile).toBe("")
  })

  test("serverUrl 结尾的斜杠被剥掉(免得拼出 //session)", () => {
    expect(readBridgeConfig({ ...full, ACP_DESKFOX_SERVER_URL: "http://127.0.0.1:4096///" }).serverUrl).toBe(
      "http://127.0.0.1:4096",
    )
  })

  test.each([
    ["ACP_DESKFOX_SERVER_URL", "sidecar 地址"],
    ["ACP_DESKFOX_SERVER_AUTH", "Authorization"],
    ["ACP_DESKFOX_VOICE_DIR", "独立目录"],
  ])("缺 %s → 抛错,且消息里点名这个变量", (name, hint) => {
    const env = { ...full } as Record<string, string>
    delete env[name]
    expect(() => readBridgeConfig(env)).toThrow(new RegExp(name))
    try {
      readBridgeConfig(env)
    } catch (e) {
      const msg = String((e as Error).message)
      expect(msg).toContain(hint)
      // 报人话:得说清是谁该注入这些值,否则手工调试时无从下手
      expect(msg).toContain("launch-config.ts")
    }
  })

  test("空串 / 纯空白等同于缺失(qwen 对空值和未设的处理不一样,少一个歧义源)", () => {
    expect(() => readBridgeConfig({ ...full, ACP_DESKFOX_SERVER_AUTH: "   " })).toThrow()
    expect(() => readBridgeConfig({ ...full, ACP_DESKFOX_SERVER_URL: "" })).toThrow()
  })

  test("一次列全所有缺失项,不用一个个试出来", () => {
    try {
      readBridgeConfig({})
      throw new Error("本该抛错")
    } catch (e) {
      const msg = String((e as Error).message)
      expect(msg).toContain("ACP_DESKFOX_SERVER_URL")
      expect(msg).toContain("ACP_DESKFOX_SERVER_AUTH")
      expect(msg).toContain("ACP_DESKFOX_VOICE_DIR")
    }
  })
})

describe("basicAuthHeader", () => {
  test("与 sidecar 的校验形状一致(base64 of user:pass)", () => {
    expect(basicAuthHeader("opencode", "pw")).toBe(`Basic ${Buffer.from("opencode:pw").toString("base64")}`)
  })

  test("密码含非 ASCII 也不炸(randomUUID 不会,但别让它成为惊喜)", () => {
    expect(basicAuthHeader("opencode", "密码🦊")).toStartWith("Basic ")
  })
})

describe("parseModelRef — coordinator 路由模型", () => {
  test("provider/model 正常解析", () => {
    expect(parseModelRef("claude-code/opus")).toEqual({ providerID: "claude-code", modelID: "opus" })
  })

  test("modelID 自身带斜杠时只在第一个斜杠处切", () => {
    expect(parseModelRef("openrouter/anthropic/claude-opus")).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude-opus",
    })
  })

  // 配错不该让语音起不来:回落成「跟随绑定模型」
  test("形状不对一律 null(不猜)", () => {
    for (const bad of ["", "   ", "没有斜杠", "/开头就是斜杠", "结尾是斜杠/"]) {
      expect(parseModelRef(bad)).toBeNull()
    }
  })
})

describe("readBridgeConfig 的 coordinatorModel", () => {
  test("配了就解析出来", () => {
    const c = readBridgeConfig({ ...full, ACP_DESKFOX_COORDINATOR_MODEL: "claude-code/opus" })
    expect(c.coordinatorModel).toEqual({ providerID: "claude-code", modelID: "opus" })
  })

  test("没配 / 配错 → null,退化成跟随 DeskFox 绑定模型", () => {
    expect(readBridgeConfig(full).coordinatorModel).toBeNull()
    expect(readBridgeConfig({ ...full, ACP_DESKFOX_COORDINATOR_MODEL: "乱写" }).coordinatorModel).toBeNull()
  })
})
