// [fork-only] voice-acp-bridge — ACP 桥模式的启动 env 构造 [feat: voice-acp-bridge] 2026-08-24
//
// 两条用例直接来自 2026-08-24 的真机 QA(local 包),都是单测与集成测试**测不出来**的:
//   ① coordinator 模型必须显式指定 —— 跟随绑定模型时,绑了小上下文模型就整条语音哑掉;
//   ② voice 目录不能出现 `deskfox/deskfox`(XDG_DATA_HOME 已经是 deskfox 命名空间)。
import { describe, expect, test } from "bun:test"
import { buildAcpGatewayEnv, useAcpBridge, voiceCoordinatorDir } from "./launch-config"

const SERVER = { url: "http://127.0.0.1:55585", username: "opencode", password: "pw-uuid" }

const build = (over: Partial<Parameters<typeof buildAcpGatewayEnv>[0]> = {}) =>
  buildAcpGatewayEnv({
    workspace: "/proj",
    bridgePath: "/repo/packages/desktop/scripts/deskfox-voice-bridge.mjs",
    server: SERVER,
    env: { XDG_DATA_HOME: "/home/u/.local/share/deskfox", PATH: "/usr/bin" },
    exists: () => true,
    authPath: "/nonexistent-auth.json",
    ...over,
  })

describe("voiceCoordinatorDir — 真机 QA 打出来的路径重复", () => {
  test("XDG_DATA_HOME 已是 deskfox 命名空间时,不再多拼一层", () => {
    expect(voiceCoordinatorDir({ XDG_DATA_HOME: "/home/u/.local/share/deskfox" })).toBe(
      "/home/u/.local/share/deskfox/voice-workspace",
    )
  })

  test("没设 XDG_DATA_HOME 时回落值自带 deskfox 一层(与 deskfoxXdgDefaults 对齐)", () => {
    expect(voiceCoordinatorDir({}, "/home/u")).toBe("/home/u/.local/share/deskfox/voice-workspace")
  })

  test("DESKFOX_VOICE_DIR 可整体覆盖", () => {
    expect(voiceCoordinatorDir({ DESKFOX_VOICE_DIR: "/custom/voice" })).toBe("/custom/voice")
  })
})

describe("buildAcpGatewayEnv", () => {
  test("五个 ACP_DESKFOX_* 配置齐全,且都带能穿过 qwen 白名单的前缀", () => {
    const { env } = build()
    for (const k of [
      "ACP_DESKFOX_SERVER_URL",
      "ACP_DESKFOX_SERVER_AUTH",
      "ACP_DESKFOX_VOICE_DIR",
      "ACP_DESKFOX_ACTIVE_PROJECT_FILE",
      "ACP_DESKFOX_LOG_FILE",
      "ACP_DESKFOX_COORDINATOR_MODEL",
      "ACP_DESKFOX_TASK_MODEL",
    ]) {
      expect(env[k]).toBeTruthy()
      expect(k.startsWith("ACP_")).toBe(true)
    }
    expect(env.ACP_COMMAND).toBe("/repo/packages/desktop/scripts/deskfox-voice-bridge.mjs")
    expect(env.ACP_WORKSPACE).toBe("/proj")
  })

  // ★ 真机 QA 两条教训:① 小上下文模型吞不下 4.6k 字信封 → 400;
  //   ② claude-code 档下 coordinator 看不见 MCP 工具、一次都不派活(A/B 实测)
  test("coordinator 模型单独一档,默认**不是** backend 档(不能是 claude-code)", () => {
    const model = build().env.ACP_DESKFOX_COORDINATOR_MODEL
    expect(model).toBe("alibaba-cn/qwen3.8-max")
    expect(model).not.toBe("claude-code/opus")
    expect(model.startsWith("claude-code/")).toBe(false)
  })

  test("改 backend 档不会连带改 coordinator(两者互不影响)", () => {
    const { env } = build({
      env: {
        XDG_DATA_HOME: "/home/u/.local/share/deskfox",
        PATH: "/usr/bin",
        DESKFOX_VOICE_BACKEND_MODEL: "anthropic/claude-opus-5",
      },
    })
    expect(env.ACP_DESKFOX_COORDINATOR_MODEL).toBe("alibaba-cn/qwen3.8-max")
  })

  test("coordinator 模型可经 DESKFOX_VOICE_COORDINATOR_MODEL 覆盖", () => {
    const { env } = build({
      env: {
        XDG_DATA_HOME: "/home/u/.local/share/deskfox",
        PATH: "/usr/bin",
        DESKFOX_VOICE_COORDINATOR_MODEL: "alibaba-cn/qwen3.5-plus",
      },
    })
    expect(env.ACP_DESKFOX_COORDINATOR_MODEL).toBe("alibaba-cn/qwen3.5-plus")
  })

  // user 2026-08-25 拍板:干活那层固定 Opus 5
  test("第三层任务档注入 Opus,与 coordinator 档是两个不同的值", () => {
    const { env } = build()
    expect(env.ACP_DESKFOX_TASK_MODEL).toBe("claude-code/opus")
    expect(env.ACP_DESKFOX_TASK_MODEL).not.toBe(env.ACP_DESKFOX_COORDINATOR_MODEL)
  })

  test("第三层可经 DESKFOX_VOICE_TASK_MODEL 覆盖", () => {
    const { env } = build({
      env: {
        XDG_DATA_HOME: "/home/u/.local/share/deskfox",
        PATH: "/usr/bin",
        DESKFOX_VOICE_TASK_MODEL: "alibaba-cn/qwen3.8-max",
      },
    })
    expect(env.ACP_DESKFOX_TASK_MODEL).toBe("alibaba-cn/qwen3.8-max")
  })

  test("凭据只进 env,不落命令行(ps 里看得见的地方一律没有密码)", () => {
    const { env } = build()
    expect(env.ACP_DESKFOX_SERVER_AUTH).toBe(`Basic ${Buffer.from("opencode:pw-uuid").toString("base64")}`)
    expect(env.ACP_COMMAND).not.toContain("pw-uuid")
    expect(env.ACP_WORKSPACE).not.toContain("pw-uuid")
  })

  // ★ 通用 acp backend 带 full 会被 qwen CLI 硬拒不启动
  test("绝不设 full 权限模式,也不注入旧链路那套 OPENCODE_*", () => {
    const { env } = build()
    expect(env.QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE).toBeUndefined()
    expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined()
    expect(env.OPENCODE_BIN).toBeUndefined()
    expect(env.OPENCODE_PORT).toBeUndefined()
  })

  test("sidecar 没就绪时给出空 URL + 人话 warning,由调用方拒绝启动", () => {
    const { env, warnings } = build({ server: null })
    expect(env.ACP_DESKFOX_SERVER_URL).toBe("")
    expect(warnings.join()).toContain("sidecar")
  })

  test("桥脚本不存在会 warn(setup 的 ready 判据就是这个文件)", () => {
    expect(build({ exists: () => false }).warnings.join()).toContain("语音桥脚本不存在")
  })

  test("Gateway 自己要的 realtime/唤醒词 env 仍在", () => {
    const { env } = build()
    expect(env.QWEN_AUDIO_REALTIME_MODEL).toBeTruthy()
    expect(env.QWEN_AUDIO_WAKE_WORD_ENABLED).toBe("true")
  })
})

describe("useAcpBridge — 回退开关", () => {
  test("默认走新链路", () => {
    expect(useAcpBridge({})).toBe(true)
  })

  test("DESKFOX_VOICE_LEGACY_BACKEND=1/true 退回旧链路", () => {
    expect(useAcpBridge({ DESKFOX_VOICE_LEGACY_BACKEND: "1" })).toBe(false)
    expect(useAcpBridge({ DESKFOX_VOICE_LEGACY_BACKEND: "TRUE" })).toBe(false)
  })

  test("其它值不算开关(免得手滑写个 0 反而退回去)", () => {
    expect(useAcpBridge({ DESKFOX_VOICE_LEGACY_BACKEND: "0" })).toBe(true)
    expect(useAcpBridge({ DESKFOX_VOICE_LEGACY_BACKEND: "" })).toBe(true)
  })
})
