// [fork-only] REQ-102 语音派活 — 三钉死单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 1-spec §4·S0;R8 用例 T9/T10/T11 的可自动化部分(真机断言部分在 §7 清单里)。
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  applyVoiceHarnessXdg,
  deskfoxXdgDefaults,
  DASHSCOPE_PROVIDER_ID,
  KNOWN_REALTIME_MODELS,
  MIN_SIDECAR_VERSION,
  VOICE_MODEL_DEFAULTS,
  assessAgentVersion,
  compareVersion,
  isKnownRealtimeModel,
  parseSidecarVersion,
  readProviderApiKey,
  resolveAuthJsonPath,
  resolveAcpHost,
  resolveVoiceModels,
} from "./launch-env"

describe("① ACP 宿主(D-G:本仓 1.x 源码入口)", () => {
  const allExist = () => true

  test("拼出 bun + 1.x 源码入口 + acp", () => {
    const h = resolveAcpHost({ repoRoot: "/repo", bunPath: "/b/bun", exists: allExist, env: {} })
    expect(h.command).toBe("/b/bun")
    expect(h.args).toEqual(["/repo/packages/opencode/src/index.ts", "acp"])
    expect(h.entry).toBe("/repo/packages/opencode/src/index.ts")
  })

  test("仓路径可从 env 来(装好的 app 靠它找到源码树)", () => {
    const h = resolveAcpHost({ env: { DESKFOX_VOICE_REPO_ROOT: "/r" }, bunPath: "bun", exists: allExist })
    expect(h.repoRoot).toBe("/r")
  })

  test("没配仓路径 → 抛错(语音入口据此禁用,不是点了没反应)", () => {
    expect(() => resolveAcpHost({ env: {}, exists: allExist })).toThrow(/DESKFOX_VOICE_REPO_ROOT/)
  })

  test("入口文件不存在 → 抛错并把路径打出来", () => {
    expect(() => resolveAcpHost({ repoRoot: "/nope", env: {}, exists: () => false })).toThrow(
      /找不到 ACP 入口.*\/nope/,
    )
  })

  test("bun 解析顺序:显式 > env > BUN_INSTALL > PATH", () => {
    expect(resolveAcpHost({ repoRoot: "/r", bunPath: "/explicit/bun", env: {}, exists: allExist }).command).toBe(
      "/explicit/bun",
    )
    expect(
      resolveAcpHost({ repoRoot: "/r", env: { DESKFOX_VOICE_BUN: "/env/bun" }, exists: allExist }).command,
    ).toBe("/env/bun")
    expect(resolveAcpHost({ repoRoot: "/r", env: { BUN_INSTALL: "/bi" }, exists: allExist }).command).toBe(
      "/bi/bin/bun",
    )
    expect(resolveAcpHost({ repoRoot: "/r", env: {}, exists: allExist }).command).toBe("bun")
  })

  // qwen 会按白名单过滤 ACP 子进程的 env,自定义变量传不进来 → wrapper 用自身位置兜底
  test("env 没有仓路径时用 fallbackRepoRoot(wrapper 自定位)", () => {
    const h = resolveAcpHost({ env: {}, fallbackRepoRoot: "/self", exists: allExist })
    expect(h.repoRoot).toBe("/self")
  })

  test("env 显式给的优先于自定位(power user 可强制指定别的仓)", () => {
    const h = resolveAcpHost({ env: { DESKFOX_VOICE_REPO_ROOT: "/env" }, fallbackRepoRoot: "/self", exists: allExist })
    expect(h.repoRoot).toBe("/env")
  })

  test("带 OPENCODE_ 前缀的那份也认(它才穿得过 qwen 的 env 白名单)", () => {
    const h = resolveAcpHost({ env: { OPENCODE_DESKFOX_VOICE_REPO_ROOT: "/prefixed" }, exists: allExist })
    expect(h.repoRoot).toBe("/prefixed")
  })

  test("自定位到的目录不是 fork 仓 → 仍然抛错,不硬撑", () => {
    expect(() => resolveAcpHost({ env: {}, fallbackRepoRoot: "/not-a-repo", exists: () => false })).toThrow()
  })

  test("**永远不会退化成 PATH 上的 opencode**(那儿躺着 1.17.4)", () => {
    const h = resolveAcpHost({ repoRoot: "/r", env: {}, exists: allExist })
    expect(h.command).not.toContain("opencode")
    expect(h.args[0]).toContain("/r/packages/opencode/src/index.ts")
  })

  test("版本号解析:裸版本 / 带前缀 / 带后缀", () => {
    expect(parseSidecarVersion("1.18.16")).toBe("1.18.16")
    expect(parseSidecarVersion("opencode 1.18.16\n")).toBe("1.18.16")
    expect(parseSidecarVersion("1.18.16-dev.3")).toBe("1.18.16")
    expect(parseSidecarVersion("")).toBeNull()
    expect(parseSidecarVersion("no version here")).toBeNull()
  })

  test("版本比较", () => {
    expect(compareVersion("1.18.16", "1.18.0")).toBe(1)
    expect(compareVersion("1.17.4", "1.18.0")).toBe(-1)
    expect(compareVersion("1.18.0", "1.18.0")).toBe(0)
    // 段内按数值比,不按字典序(1.9 < 1.10)
    expect(compareVersion("1.9.0", "1.10.0")).toBe(-1)
  })

  // 版本号在三种合法形态下各不相同,不能当准入判据(2026-08-21 三处实测):
  //   源码态 "local" / 内置 v2 二进制 "opencode2 v0.0.0-next-16350" / homebrew "1.17.4"
  test("源码态 agentInfo.version = 'local' → unknown,放行", () => {
    const r = assessAgentVersion("local")
    expect(r.level).toBe("unknown")
    expect(r.version).toBeNull()
  })

  test("内置 v2 二进制 '0.0.0-next-16350' → unknown(是构建戳,不是低版本)", () => {
    const r = assessAgentVersion("opencode2 v0.0.0-next-16350")
    expect(r.level).toBe("unknown")
    expect(r.version).toBe("0.0.0")
  })

  test("正经 1.18.16 → ok", () => {
    expect(assessAgentVersion("1.18.16").level).toBe("ok")
  })

  test("homebrew 那个 1.17.4 → stale(唯一硬拦的情形)", () => {
    const r = assessAgentVersion("1.17.4")
    expect(r.level).toBe("stale")
    expect(r.note).toContain(MIN_SIDECAR_VERSION)
  })

  test("空输出 → unknown 放行(身份已由路径构造保证,不靠版本 fail-closed)", () => {
    expect(assessAgentVersion("").level).toBe("unknown")
  })
})

describe("② DASHSCOPE key 按 XDG 推导", () => {
  test("XDG_DATA_HOME 存在 → 用它(= deskfox 命名空间)", () => {
    expect(resolveAuthJsonPath({ XDG_DATA_HOME: "/h/.local/share/deskfox" }, "/h")).toBe(
      "/h/.local/share/deskfox/opencode/auth.json",
    )
  })

  test("XDG_DATA_HOME 缺失 → 回落 ~/.local/share(上游默认)", () => {
    expect(resolveAuthJsonPath({}, "/h")).toBe("/h/.local/share/opencode/auth.json")
  })

  test("**不得**硬编码成旧的 ~/.local/share/opencode —— 设了 XDG 就必须跟着走", () => {
    const p = resolveAuthJsonPath({ XDG_DATA_HOME: "/h/.local/share/deskfox" }, "/h")
    expect(p.includes("/share/deskfox/")).toBe(true)
  })

  test("读 alibaba-cn key:命中 / 类型不对 / 文件缺失", () => {
    const good = JSON.stringify({ [DASHSCOPE_PROVIDER_ID]: { type: "api", key: "sk-xxx" } })
    expect(readProviderApiKey(DASHSCOPE_PROVIDER_ID, "/a", () => good)).toBe("sk-xxx")

    // oauth 型(anthropic 就是这种)不是 api key,不能当 key 用
    const oauth = JSON.stringify({ [DASHSCOPE_PROVIDER_ID]: { type: "oauth", access: "tok" } })
    expect(readProviderApiKey(DASHSCOPE_PROVIDER_ID, "/a", () => oauth)).toBeNull()

    expect(readProviderApiKey(DASHSCOPE_PROVIDER_ID, "/a", () => null)).toBeNull()
    expect(readProviderApiKey(DASHSCOPE_PROVIDER_ID, "/a", () => "{ 坏 json")).toBeNull()
  })
})

describe("②b 测试装置的 XDG 补齐(防「验错环境」)", () => {
  test("未设 XDG → 补成 deskfox 命名空间,装置因此读到与生产同一份 auth.json", () => {
    const env = applyVoiceHarnessXdg({}, "/h")
    expect(env.XDG_DATA_HOME).toBe("/h/.local/share/deskfox")
    expect(env.XDG_CONFIG_HOME).toBe("/h/.config/deskfox")
    expect(resolveAuthJsonPath(env, "/h")).toBe("/h/.local/share/deskfox/opencode/auth.json")
  })

  test("已显式设过 → 尊重,不覆盖", () => {
    const env = applyVoiceHarnessXdg({ XDG_DATA_HOME: "/custom/d", XDG_CONFIG_HOME: "/custom/c" }, "/h")
    expect(env.XDG_DATA_HOME).toBe("/custom/d")
    expect(env.XDG_CONFIG_HOME).toBe("/custom/c")
  })

  test("不改入参(纯函数)", () => {
    const src: NodeJS.ProcessEnv = {}
    applyVoiceHarnessXdg(src, "/h")
    expect(src.XDG_DATA_HOME).toBeUndefined()
  })

  // 源码守卫:deskfoxXdgDefaults 是 data-namespace.ts 的手抄件(那边顶层 import electron-log,
  // 装置/单测里 import 即炸)。上游或 fork 改了那边的默认值,这条会红,提醒同步。
  test("与 data-namespace.ts 的默认值不漂移", () => {
    const src = readFileSync(path.join(import.meta.dir, "..", "data-namespace.ts"), "utf-8")
    expect(src).toContain(`join(home, ".local", "share", "deskfox")`)
    expect(src).toContain(`join(home, ".config", "deskfox")`)
    const d = deskfoxXdgDefaults("/h")
    expect(d.dataHome).toBe("/h/.local/share/deskfox")
    expect(d.configHome).toBe("/h/.config/deskfox")
  })
})

// 原名「三个模型(D-F)」;voice-acp-bridge 加了第 4 档 coordinator(见下方 A/B 那条用例)
describe("③ 四个模型(D-F + coordinator)", () => {
  test("默认值 = 定案值", () => {
    expect(resolveVoiceModels({})).toEqual({
      backend: "claude-code/opus",
      small: "alibaba-cn/qwen-flash",
      realtime: "qwen-audio-3.0-realtime-plus",
      coordinator: "alibaba-cn/qwen3.8-max",
      task: "",
    })
  })

  // 这条断言的历史值得留:2026-08-21 曾反过来守「默认后端**不能**是 claude-code 系」——
  // 因为那时 provider 不把 opencode 的工具透传给 claude CLI,它手里一个 MCP 工具都没有,
  // 第三层 Session 能力(走 MCP 下发)会**静默**失效。plugin 侧 B1+B2 修好后前提消失,
  // 2026-08-22 user 拍板换回 Opus。现在守的是另一件事:small_model 不能跟着上去烧订阅额度。
  test("标题这类杂活仍走便宜的小模型,不跟着主模型烧订阅额度", () => {
    expect(VOICE_MODEL_DEFAULTS.small.startsWith("alibaba-cn/")).toBe(true)
    expect(VOICE_MODEL_DEFAULTS.small).not.toBe(VOICE_MODEL_DEFAULTS.backend)
  })

  test("五个位置各自可 env 覆盖(换模型不改代码)", () => {
    expect(
      resolveVoiceModels({
        DESKFOX_VOICE_BACKEND_MODEL: "alibaba-cn/qwen3-max",
        DESKFOX_VOICE_SMALL_MODEL: "anthropic/claude-haiku-4-5",
        DESKFOX_VOICE_REALTIME_MODEL: "qwen3.5-omni-plus-realtime",
        DESKFOX_VOICE_COORDINATOR_MODEL: "alibaba-cn/qwen3.5-plus",
        DESKFOX_VOICE_TASK_MODEL: "anthropic/claude-opus-5",
      }),
    ).toEqual({
      backend: "alibaba-cn/qwen3-max",
      small: "anthropic/claude-haiku-4-5",
      realtime: "qwen3.5-omni-plus-realtime",
      coordinator: "alibaba-cn/qwen3.5-plus",
      task: "anthropic/claude-opus-5",
    })
  })

  // ★ 2026-08-25 真机 A/B(voice-acp-bridge):同一份 prompt,coordinator 跑 claude-code/opus
  //   一次都不派活(看不见 MCP 工具),换成阿里档第一次就正确派活。
  //   上面那条注释说的「plugin B1+B2 修好后前提消失」只对**旧链路**成立 ——
  //   那个修法依赖 `deskfox-acp-wrap.mjs` 的旁路文件合并,而新链路根本没有 wrapper。
  //   所以 coordinator 这一档必须避开 claude-code 系,且**不跟 backend 同值**。
  test("coordinator 档避开 claude-code 系,且与 backend 解耦", () => {
    expect(VOICE_MODEL_DEFAULTS.coordinator.startsWith("claude-code/")).toBe(false)
    expect(VOICE_MODEL_DEFAULTS.coordinator).not.toBe(VOICE_MODEL_DEFAULTS.backend)
    // 改 backend 不该连带改 coordinator
    expect(resolveVoiceModels({ DESKFOX_VOICE_BACKEND_MODEL: "claude-code/opus" }).coordinator).toBe(
      VOICE_MODEL_DEFAULTS.coordinator,
    )
  })

  test("空串 / 纯空白视为未设,回落默认", () => {
    expect(resolveVoiceModels({ DESKFOX_VOICE_BACKEND_MODEL: "  " }).backend).toBe(VOICE_MODEL_DEFAULTS.backend)
    expect(resolveVoiceModels({ DESKFOX_VOICE_REALTIME_MODEL: "" }).realtime).toBe(VOICE_MODEL_DEFAULTS.realtime)
  })

  test("realtime 白名单 = 1.11.0 catalog 四档;未知 id 可识别(qwen 侧会静默回落 unknown 档)", () => {
    for (const id of KNOWN_REALTIME_MODELS) expect(isKnownRealtimeModel(id)).toBe(true)
    // 1.7.0 时代的这个已被 qwen3.5 系取代,不在 1.11.0 catalog 里
    expect(isKnownRealtimeModel("qwen3-omni-flash-realtime")).toBe(false)
    expect(isKnownRealtimeModel("")).toBe(false)
  })

  test("默认 realtime 必须在白名单内(防以后改默认值改出个哑档)", () => {
    expect(isKnownRealtimeModel(VOICE_MODEL_DEFAULTS.realtime)).toBe(true)
  })
})

// 架构原则(user 2026-08-25 纠正):模型配置和 session 一样走 DeskFox 通路。
// 曾短暂钉死过 claude-code/opus,那是拿改架构默认值去解"测试包没绑模型"的问题,已回退。
describe("第三层任务档", () => {
  test("默认空 = 跟随 DeskFox 绑定的模型(不在语音链路里另配一套)", () => {
    expect(VOICE_MODEL_DEFAULTS.task).toBe("")
  })

  test("coordinator 仍避开 claude-code(它看不见动态注册的 MCP,派不出活)", () => {
    expect(VOICE_MODEL_DEFAULTS.coordinator.startsWith("claude-code/")).toBe(false)
  })

  test("可经 DESKFOX_VOICE_TASK_MODEL 换回国产直连(claude CLI 要代理)", () => {
    expect(resolveVoiceModels({ DESKFOX_VOICE_TASK_MODEL: "alibaba-cn/qwen3.8-max" }).task).toBe(
      "alibaba-cn/qwen3.8-max",
    )
  })
})
