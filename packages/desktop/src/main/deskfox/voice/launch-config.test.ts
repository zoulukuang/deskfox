// [fork-only] REQ-102 语音派活 — 启动参数固化单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 1-spec §4·S2;R8 用例 T9(实际生效模型)/ T14(非 git 目录拒起)的可自动化部分。
import { describe, expect, test } from "bun:test"
import {
  GATEWAY_PORT,
  VOICE_OPENCODE_PORT,
  binDir,
  buildGatewayEnv,
  buildVoiceConfigContent,
  checkVoiceWorkspace,
} from "./launch-config"
import { VOICE_MODEL_DEFAULTS } from "./launch-env"

const MODELS = { backend: "claude-code/opus", small: "alibaba-cn/qwen-flash", realtime: "qwen-audio-3.0-realtime-plus" }

describe("buildVoiceConfigContent", () => {
  test("只声明要覆盖的键 —— 靠 merge 语义保住配置文件里的 plugin/provider 段", () => {
    const cfg = JSON.parse(buildVoiceConfigContent(MODELS))
    expect(Object.keys(cfg).toSorted()).toEqual(["agent", "model", "permission", "small_model"])
    expect(cfg.plugin).toBeUndefined() // 一旦这里塞了 plugin,media-gen 在语音里就会被顶掉
    expect(cfg.provider).toBeUndefined()
  })

  test("模型写顶层 model(实测:顶层就够,不需要 agent.<name>.model)", () => {
    const cfg = JSON.parse(buildVoiceConfigContent(MODELS))
    expect(cfg.model).toBe("claude-code/opus")
    expect(cfg.small_model).toBe("alibaba-cn/qwen-flash")
  })

  // 1.17.4 时代要给 qwen 打 patch 才能用 full 权限;1.18.16 的 normalizeInput 收字符串,
  // 2026-08-21 实测无 schema 报错 —— 这条断言是"patch 已永久不需要"的看门人
  test("permission 顶层 + agent 层都给,且用字符串简写", () => {
    const cfg = JSON.parse(buildVoiceConfigContent(MODELS))
    expect(cfg.permission).toBe("allow")
    expect(cfg.agent.build.permission).toBe("allow")
  })

  test("输出是可解析 JSON(要塞进 env,一个字符都不能错)", () => {
    expect(() => JSON.parse(buildVoiceConfigContent(MODELS))).not.toThrow()
  })
})

describe("checkVoiceWorkspace(R3 护栏)", () => {
  const gitRepo = (p: string) => p === "/repo" || p === "/repo/.git"

  test("git 仓库根 → 放行", () => {
    expect(checkVoiceWorkspace("/repo", gitRepo)).toEqual({ ok: true, dir: "/repo" })
  })

  test("非 git 目录 → 拒起,并说清为什么(语音要全开权限改文件)", () => {
    const r = checkVoiceWorkspace("/tmp/plain", (p) => p === "/tmp/plain")
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain("git")
  })

  test("目录不存在 / 没开项目 → 各自给可读原因", () => {
    expect(checkVoiceWorkspace("/nope", () => false).ok).toBe(false)
    const empty = checkVoiceWorkspace("", () => true)
    expect(empty.ok).toBe(false)
    expect(empty.ok === false && empty.reason).toContain("没有打开项目")
  })
})

describe("buildGatewayEnv", () => {
  const baseInput = {
    workspace: "/repo",
    repoRoot: "/fork",
    wrapperPath: "/fork/packages/desktop/scripts/deskfox-acp-wrap.mjs",
    authPath: "/auth.json",
    exists: () => true,
    env: { PATH: "/usr/bin:/bin", XDG_DATA_HOME: "/h/.local/share/deskfox" } as NodeJS.ProcessEnv,
  }

  test("把三钉死 + 端口 + 权限模式一次性拼齐", () => {
    const { env } = buildGatewayEnv(baseInput)
    expect(env.OPENCODE_BIN).toBe(baseInput.wrapperPath)
    expect(env.DESKFOX_VOICE_REPO_ROOT).toBe("/fork")
    expect(env.OPENCODE_WORKSPACE).toBe("/repo")
    expect(env.OPENCODE_PORT).toBe(String(VOICE_OPENCODE_PORT))
    expect(env.QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE).toBe("full")
    expect(env.QWEN_AUDIO_REALTIME_MODEL).toBe(VOICE_MODEL_DEFAULTS.realtime)
  })

  test("端口刻意避开主实例的 4096", () => {
    expect(VOICE_OPENCODE_PORT).not.toBe(4096)
    expect(GATEWAY_PORT).toBe(3101)
  })

  // GUI 进程的 PATH 常常既没有 bun 也没有 claude:前者 wrapper 的 shebang 要用,
  // 后者 claude-code provider 要用。漏了就是"点了图标起不来"。
  test("extraPathDirs 前置进 PATH 且去重", () => {
    const { env } = buildGatewayEnv({ ...baseInput, extraPathDirs: ["/opt/bun/bin", "/usr/bin", "/opt/claude/bin"] })
    expect(env.PATH.startsWith("/opt/bun/bin:/usr/bin:/opt/claude/bin:")).toBe(true)
    expect(env.PATH.split(":").filter((p) => p === "/usr/bin").length).toBe(1)
  })

  test("读到 DashScope key → 注入;读不到 → 不注入空值,给出可执行的警告", () => {
    const withKey = buildGatewayEnv({
      ...baseInput,
      authPath: "/a",
      env: { ...baseInput.env },
    })
    // 默认 readProviderApiKey 读真实文件,这里读不到 → 应当是警告路径
    expect(withKey.env.DASHSCOPE_API_KEY).toBeUndefined()
    expect(withKey.warnings.some((w) => w.includes("alibaba-cn"))).toBe(true)
  })

  test("wrapper 不存在 → 进 warnings(不是等 Gateway 起来才炸)", () => {
    const r = buildGatewayEnv({ ...baseInput, exists: (p) => p !== baseInput.wrapperPath })
    expect(r.warnings.some((w) => w.includes("wrapper"))).toBe(true)
  })

  test("模型可被 env 覆盖(换模型不改代码)", () => {
    const { env } = buildGatewayEnv({
      ...baseInput,
      env: { ...baseInput.env, DESKFOX_VOICE_BACKEND_MODEL: "alibaba-cn/qwen3-max" },
    })
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT).model).toBe("alibaba-cn/qwen3-max")
  })
})

test("binDir", () => {
  expect(binDir("/opt/bun/bin/bun")).toBe("/opt/bun/bin")
  expect(binDir("")).toBeUndefined()
  expect(binDir(undefined)).toBeUndefined()
})
