// [fork-only] REQ-102 语音派活 — 启动参数固化单测 [feat: voice-dispatch-minimal] 2026-08-21
// 对应 1-spec §4·S2;R8 用例 T9(实际生效模型)/ T14(非 git 目录拒起)的可自动化部分。
import { describe, expect, test } from "bun:test"
import {
  GATEWAY_PORT,
  VOICE_DB_FILENAME,
  VOICE_OPENCODE_PORT,
  binDir,
  buildGatewayEnv,
  buildVoiceConfigContent,
  checkVoiceWorkspace,
  needsOverseasNetwork,
  resolveVoiceDbEnv,
  VOICE_ROUTING_INSTRUCTIONS,
  writeVoiceInstructionsFile,
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

  // 2026-08-21 真机:第三层 session 标题出来是英文(`Count files in voice-test and writ`)——
  // 内置 title prompt 说「跟随用户语言」,但语音链路里首条 prompt 是 coordinator 转写过的、常已是英文。
  // 这里直接硬性要求简体中文,不跟随。
  test("覆盖 title agent 的 prompt —— 标题必须是中文", () => {
    const cfg = JSON.parse(buildVoiceConfigContent(MODELS))
    expect(typeof cfg.agent.title.prompt).toBe("string")
    expect(cfg.agent.title.prompt).toContain("简体中文")
    // 不能只是「跟随用户语言」那种软措辞,否则等于没覆盖
    expect(cfg.agent.title.prompt).not.toContain("same language")
    // 覆盖 prompt 不该顺手改掉 build 的权限
    expect(cfg.agent.build.permission).toBe("allow")
  })

  // 2026-08-21 真机:「分析今日A股市场盘面」(9 次 macro 调用 + 完整分析)都被判成「其余任务」
  // 留在 coordinator 里 —— 阈值偏高,用户不该靠说「新开一个独立任务」这种咒语来触发。
  test("带 instructions 路径时才注入,且只追加不覆盖", () => {
    const withPath = JSON.parse(buildVoiceConfigContent(MODELS, "/s/deskfox/voice-routing.md"))
    expect(withPath.instructions).toEqual(["/s/deskfox/voice-routing.md"])

    // 写文件失败时传空串,这时不能塞一个空数组进去(会盖掉用户自己配的 instructions)
    const without = JSON.parse(buildVoiceConfigContent(MODELS, ""))
    expect("instructions" in without).toBe(false)
    expect("instructions" in JSON.parse(buildVoiceConfigContent(MODELS))).toBe(false)
  })

  test("路由引导:倾向开新 session,且限定在有 session 工具时才适用", () => {
    // 第三层 session 读同一份 config,没有这些工具 —— 必须写清适用条件,否则它会照着做无用功
    expect(VOICE_ROUTING_INSTRUCTIONS).toContain("session_start")
    expect(VOICE_ROUTING_INSTRUCTIONS).toContain("没有就完全忽略")
    expect(VOICE_ROUTING_INSTRUCTIONS).toContain("倾向于开")
    // 不能依赖用户说特定咒语
    expect(VOICE_ROUTING_INSTRUCTIONS).toContain("不是用户有没有说")
  })

  test("writeVoiceInstructionsFile:落到 XDG state 下,写失败返回空串不抛", () => {
    const written: Record<string, string> = {}
    const p = writeVoiceInstructionsFile({ XDG_STATE_HOME: "/s" } as NodeJS.ProcessEnv, "/h", (f, c) => {
      written[f] = c
    })
    expect(p).toBe("/s/deskfox/voice-routing.md")
    expect(written[p]).toBe(VOICE_ROUTING_INSTRUCTIONS)

    const failed = writeVoiceInstructionsFile({ XDG_STATE_HOME: "/s" } as NodeJS.ProcessEnv, "/h", () => {
      throw new Error("EACCES")
    })
    expect(failed).toBe("")
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
    disableChannelDb: true,
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

  // 2026-08-21 真机的总根因:spawn 是整份替换 env,漏带 XDG/HOME → Gateway 及其拉起的
  // opencode 全部回落 `~/.local/share/opencode`(实测语音库真的生成在那里),
  // auth / 会话 / db 一起离开 DeskFox 命名空间。这条是 D-A 的地基,必须钉住。
  test("XDG / HOME 原样带过去 —— 否则整条链掉出 DeskFox 命名空间", () => {
    const { env } = buildGatewayEnv({
      ...baseInput,
      env: {
        PATH: "/usr/bin",
        HOME: "/h",
        USER: "u",
        XDG_DATA_HOME: "/h/.local/share/deskfox",
        XDG_CONFIG_HOME: "/h/.config/deskfox",
        XDG_STATE_HOME: "/h/Library/Application Support/ai.deskfox.app.local",
      } as NodeJS.ProcessEnv,
    })
    expect(env.HOME).toBe("/h")
    expect(env.XDG_DATA_HOME).toBe("/h/.local/share/deskfox")
    expect(env.XDG_CONFIG_HOME).toBe("/h/.config/deskfox")
    expect(env.XDG_STATE_HOME).toBe("/h/Library/Application Support/ai.deskfox.app.local")
  })

  // 2026-08-21 真机第二形态:活派出去了、任务也跑完了,结果是
  // `Failed to authenticate. API Error: 403 Request not allowed` —— claude-code/opus 会 spawn
  // claude CLI,这台机器直连 Anthropic 被拒。二分确证:最小 env 复现,只加回代理就恢复。
  test("代理 / CA 变量一起带过去 —— 否则后端模型直连境外必 403", () => {
    const { env } = buildGatewayEnv({
      ...baseInput,
      env: {
        PATH: "/usr/bin",
        HOME: "/h",
        HTTPS_PROXY: "http://127.0.0.1:7890",
        https_proxy: "http://127.0.0.1:7890",
        NO_PROXY: "localhost,127.0.0.1",
        NODE_EXTRA_CA_CERTS: "/h/ca.pem",
      } as NodeJS.ProcessEnv,
    })
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:7890")
    expect(env.https_proxy).toBe("http://127.0.0.1:7890")
    expect(env.NO_PROXY).toBe("localhost,127.0.0.1")
    expect(env.NODE_EXTRA_CA_CERTS).toBe("/h/ca.pem")
  })

  test("要出海的后端 + 一个代理变量都没有 → 给出可执行的警告(不阻塞)", () => {
    // 默认后端已经是国产直连,所以这里要**显式**切到出海模型才测得到这条警告
    const oversea = { PATH: "/usr/bin", HOME: "/h", DESKFOX_VOICE_BACKEND_MODEL: "claude-code/opus" }
    const r = buildGatewayEnv({ ...baseInput, env: oversea as NodeJS.ProcessEnv })
    expect(r.warnings.some((w) => w.includes("403"))).toBe(true)

    // 有代理就别唠叨
    const withProxy = buildGatewayEnv({
      ...baseInput,
      env: { ...oversea, HTTPS_PROXY: "http://127.0.0.1:7890" } as NodeJS.ProcessEnv,
    })
    expect(withProxy.warnings.some((w) => w.includes("403"))).toBe(false)

    // 默认(国产直连)不该被提醒 —— 它本来就不出海
    const domestic = buildGatewayEnv({ ...baseInput, env: { PATH: "/usr/bin", HOME: "/h" } as NodeJS.ProcessEnv })
    expect(domestic.warnings.some((w) => w.includes("403"))).toBe(false)
  })

  test("needsOverseasNetwork 判 provider 前缀,不猜模型名", () => {
    expect(needsOverseasNetwork("claude-code/opus")).toBe(true)
    expect(needsOverseasNetwork("anthropic/claude-opus-5")).toBe(true)
    expect(needsOverseasNetwork("alibaba-cn/qwen3-max")).toBe(false)
    expect(needsOverseasNetwork("")).toBe(false)
  })

  test("没设的命名空间变量不塞空值(空串和未设在下游语义不同)", () => {
    const { env } = buildGatewayEnv({ ...baseInput, env: { PATH: "/usr/bin", HOME: "" } as NodeJS.ProcessEnv })
    expect("HOME" in env).toBe(false)
    expect("XDG_DATA_HOME" in env).toBe(false)
  })

  // D-A 的本意就是共用:语音派的活要在 DeskFox 会话列表里看得见。
  // 中途曾因反复 database is locked 改过独立库,后查清那批锁是 XDG 漏带导致开错了老库,
  // 不是"共用"本身的问题 —— 命名空间修好后默认回到共用(2026-08-21 user 拍板)。
  test("默认共用主实例的库,且按渠道规则对齐它开的那个文件", () => {
    const release = buildGatewayEnv({ ...baseInput, disableChannelDb: true }).env
    expect(release.OPENCODE_DB).toBeUndefined()
    expect(release.OPENCODE_DISABLE_CHANNEL_DB).toBe("1") // 发布三档共用 opencode.db

    const local = buildGatewayEnv({ ...baseInput, disableChannelDb: false }).env
    expect(local.OPENCODE_DB).toBeUndefined()
    expect(local.OPENCODE_CHANNEL).toBe("local") // 未打包 / local 档落 opencode-local.db
  })

  test("DESKFOX_VOICE_ISOLATE_DB=1 → 逃生口,切独立库(代价:会话在 DeskFox 里看不见)", () => {
    const { env } = buildGatewayEnv({
      ...baseInput,
      env: { ...baseInput.env, DESKFOX_VOICE_ISOLATE_DB: "1" } as NodeJS.ProcessEnv,
    })
    expect(env.OPENCODE_DB).toBe(VOICE_DB_FILENAME)
    expect(env.OPENCODE_DISABLE_CHANNEL_DB).toBeUndefined()
    expect(env.OPENCODE_CHANNEL).toBeUndefined()
  })
})

describe("resolveVoiceDbEnv", () => {
  // 相对名而非绝对路径:core 的 `database.path()` 会把相对名 join 到 Global.Path.data,
  // 天然跟着我们已经设好的 XDG 走,不用在这里重算一遍目录。
  test("独立库用相对文件名,交给 core 拼目录", () => {
    expect(VOICE_DB_FILENAME.includes("/")).toBe(false)
    expect(resolveVoiceDbEnv({ DESKFOX_VOICE_ISOLATE_DB: "1" }, true)).toEqual({ OPENCODE_DB: VOICE_DB_FILENAME })
  })

  test("逃生口只认 1 / true,别的值一律走默认(共用)", () => {
    expect(resolveVoiceDbEnv({ DESKFOX_VOICE_ISOLATE_DB: "true" }, true).OPENCODE_DB).toBe(VOICE_DB_FILENAME)
    expect(resolveVoiceDbEnv({ DESKFOX_VOICE_ISOLATE_DB: "0" }, true).OPENCODE_DB).toBeUndefined()
    expect(resolveVoiceDbEnv({ DESKFOX_VOICE_ISOLATE_DB: "" }, true).OPENCODE_DB).toBeUndefined()
    expect(resolveVoiceDbEnv({}, true).OPENCODE_DISABLE_CHANNEL_DB).toBe("1")
  })
})

test("binDir", () => {
  expect(binDir("/opt/bun/bin/bun")).toBe("/opt/bun/bin")
  expect(binDir("")).toBeUndefined()
  expect(binDir(undefined)).toBeUndefined()
})
