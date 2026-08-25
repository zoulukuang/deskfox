// [fork-only] REQ-102 语音派活 — 启动环境「三钉死」单一来源 [feat: voice-dispatch-minimal] 2026-08-21
//
// 三钉死(1-spec §4·S0)存在的理由,每条都对应一次实际踩到或差点踩到的坑:
//
//   ① OPENCODE_BIN 必须指【本仓 1.x 源码入口】,绝不能落到 PATH 上的 opencode。
//      本机 PATH 上还躺着 `/opt/homebrew/bin/opencode` = 1.17.4;qwen-audio-agent 的 launcher
//      默认按 PATH 找 `opencode`。误跑到它:1.17.4 的 agent 层 permission schema 不收字符串
//      (REQ-102 §3.9 已定性)会让 full 权限模式崩;更糟的是它会用【旧版核心】去开共享 db,
//      正是 REQ-084① 要防的迁移污染 —— 而那套守卫只装在 Electron 主进程,CLI 路径没有。
//
//      ⚠️ 2026-08-21 实测推翻了「指内置 sidecar」这个原方案(D-G):
//        · 装好的 `/Applications/DeskFox.app` 的 Resources 里**没有任何 opencode CLI** ——
//          生产跑的是 `utilityProcess.fork(sidecar.js)`(v1,在 Electron 进程内),不是二进制;
//        · dev 树里那个 `resources/opencode-cli` 是 **opencode2 / v2 世代**,实测 acp 落的是
//          **`opencode-next.db`**(另一套库),用它则「语音派的活在 DeskFox 里可见」直接归零;
//        · 1.x 源码入口 `packages/opencode/src/index.ts acp` 实测正常握手(protocolVersion 1),
//          且与 app 同为 v1 世代、共用同一个 `opencode.db` ⇒ 会话可见性成立。
//      ⇒ 本批(自用)走源码入口;**身份靠"路径由我们构造"保证,不靠版本号**(见下)。
//
//      版本号不能当身份判据 —— 实测三种形态各不相同:源码态 `agentInfo.version = "local"`、
//      内置 v2 二进制 `0.0.0-next-16350`、homebrew `1.17.4`。所以版本只做**告警**,
//      唯一硬拦的情形是"干净 semver 且低于 1.18.0"(即真的跑到了老 opencode)。
//
//   ② DASHSCOPE key 必须运行时按 XDG 推导,不许硬编码路径。
//      2026-07-14 数据命名空间隔离后,活的 auth.json 在 `$XDG_DATA_HOME/opencode/auth.json`
//      (= `~/.local/share/deskfox/opencode/auth.json`),旧路径 `~/.local/share/opencode/auth.json`
//      是过期快照。两份现在都还有 alibaba-cn,所以硬编码【暂时能跑】—— 典型的 key 轮换后
//      无征兆失效。写法对齐 `packages/media-gen/src/auth.ts` 既有正确实现。
//
//   ③ 三个模型 id 必须显式钉死并可 env 覆盖(D-F)。
//      实测:`OPENCODE_MODEL` 环境变量对 ACP 会话【不生效】,唯一生效路径是 config 的 `model`
//      字段(`packages/opencode/src/acp/service.ts:752` → `defaultModelFromConfig`)。spike 里
//      "以为设了模型"其实一直在跑默认的 `opencode/big-pickle`,就是栽在这儿。
//
//      ⚠️ 2026-08-21 又踩深一层:`defaultModelFromConfig` 会先校验 `providers[p]?.models[m]`,
//      **模型不在这台机器可用清单里就静默回落**。本机实测可用清单 = alibaba-cn(106)/
//      opencode(7)/ kimi-for-coding(4)/ claude-code(4);**anthropic 一个都没有**
//      —— auth.json 里那条 anthropic 是 oauth 且 `expires` 停在 2026-02,早过期了。
//      所以后端默认档改成 `claude-code/opus`(经已配好的 ClaudeCode plugin provider,
//      user 2026-08-21 拍板)。要换回原生 anthropic 通道,先 `opencode auth login` 再改 env。
//
// 本模块只做「解析 + 判定」,不 spawn、不写文件;IO 薄壳(读 auth.json / 跑 --version)可注入,
// 方便单测。真正的进程托管在 S3、config 组装在 S2。

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// ───────────────────────────── ① ACP 宿主(D-G:本仓 1.x 源码入口) ─────────────────────────────

/** qwen-audio-agent 1.11.0 `shared/backend-catalog.mjs` 的 `setup.minimumVersion`(opencode 后端)。 */
export const MIN_SIDECAR_VERSION = "1.18.0"

/** 1.x CLI 源码入口(相对仓根)。`acp` 子命令即 `packages/opencode/src/cli/cmd/acp.ts`。 */
export const ACP_ENTRY_RELATIVE = join("packages", "opencode", "src", "index.ts")

export interface AcpHostInput {
  /** fork 仓根绝对路径;缺省读 env `DESKFOX_VOICE_REPO_ROOT` */
  readonly repoRoot?: string
  /**
   * env 与显式入参都没有时的兜底(wrapper 用**自身所在位置**推导)。
   * 为什么需要它:qwen 给 ACP 子进程的 env 是**白名单过滤**的
   * (`shared/backend-environment.mjs:75`,opencode 后端只放行 `OPENCODE_` 前缀 + 三个具名变量),
   * 自定义的 `DESKFOX_VOICE_REPO_ROOT` 根本传不到 —— 2026-08-21 真机跑 Gateway 时实测撞到。
   * wrapper 本身就住在仓里,自定位比任何 env 都可靠。
   */
  readonly fallbackRepoRoot?: string
  /** bun 可执行;缺省读 env `DESKFOX_VOICE_BUN` → `$BUN_INSTALL/bin/bun` → PATH 上的 `bun` */
  readonly bunPath?: string
  readonly env?: NodeJS.ProcessEnv
  /** 存在性判定注入点(单测用) */
  readonly exists?: (p: string) => boolean
}

export interface AcpHost {
  readonly command: string
  readonly args: readonly string[]
  readonly entry: string
  readonly repoRoot: string
}

/**
 * 解析「谁来跑 acp」。**身份由构造保证**:命令行是我们自己拼的绝对路径,永远不会退化成
 * PATH 上的 `opencode`(那儿躺着 1.17.4)。仓路径缺失/入口不存在一律抛错并给可执行的下一步 ——
 * 语音入口按钮据此禁用,而不是点了没反应或悄悄跑错的核心。
 */
export function resolveAcpHost(input: AcpHostInput = {}): AcpHost {
  const env = input.env ?? process.env
  const exists = input.exists ?? existsSync
  const repoRoot =
    String(input.repoRoot ?? env.DESKFOX_VOICE_REPO_ROOT ?? env.OPENCODE_DESKFOX_VOICE_REPO_ROOT ?? "").trim() ||
    String(input.fallbackRepoRoot ?? "").trim()
  if (!repoRoot) {
    throw new Error("[voice] 未配置 fork 仓路径(DESKFOX_VOICE_REPO_ROOT);语音派活需要本仓 1.x 源码入口")
  }
  const entry = join(repoRoot, ACP_ENTRY_RELATIVE)
  if (!exists(entry)) {
    throw new Error(`[voice] 找不到 ACP 入口:${entry}(仓路径填错了,或这份仓没有 packages/opencode)`)
  }
  const bunFromInstall = env.BUN_INSTALL ? join(env.BUN_INSTALL, "bin", "bun") : ""
  const bunPath =
    String(input.bunPath ?? env.DESKFOX_VOICE_BUN ?? "").trim() ||
    (bunFromInstall && exists(bunFromInstall) ? bunFromInstall : "") ||
    "bun"
  return { command: bunPath, args: [entry, "acp"], entry, repoRoot }
}

/** 从 `opencode --version` / `agentInfo.version` 的输出里抠出 x.y.z;抠不到返回 null(不猜)。 */
export function parseSidecarVersion(stdout: string): string | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(stdout ?? ""))
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null
}

/** 语义化版本比较:a<b → -1,a==b → 0,a>b → 1。只认三段数字,多余后缀忽略。 */
export function compareVersion(a: string, b: string): number {
  const seg = (v: string) => {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(v)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
  }
  const [x, y] = [seg(a), seg(b)]
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  }
  return 0
}

export interface AgentVersionAssessment {
  /** stale 才拦;unknown / ok 都放行 */
  readonly level: "ok" | "unknown" | "stale"
  readonly version: string | null
  readonly note: string
}

/**
 * 评估 ACP 端报上来的版本。**故意不 fail-closed** —— 版本号在三种合法形态下各不相同
 * (源码态 `local` / v2 二进制 `0.0.0-next-*` / npm 装的 `1.18.16`),拿它当准入判据会误杀。
 * 身份已由 `resolveAcpHost` 的路径构造保证,这里只回答一个问题:
 * **是不是明显跑到了老 opencode**(干净 semver 且 < 1.18.0,即 homebrew 那个 1.17.4)。
 */
export function assessAgentVersion(versionOutput: string): AgentVersionAssessment {
  const raw = String(versionOutput ?? "").trim()
  const version = parseSidecarVersion(raw)
  if (!version) {
    return { level: "unknown", version: null, note: `版本形态不认识(${raw || "空"});身份靠路径保证,放行` }
  }
  // 0.0.0-next-* 是本仓 dev/nightly 构建的版本戳,不是"低版本"
  if (version === "0.0.0") {
    return { level: "unknown", version, note: `开发构建版本戳(${raw});放行` }
  }
  if (compareVersion(version, MIN_SIDECAR_VERSION) < 0) {
    return {
      level: "stale",
      version,
      note: `opencode ${version} 低于 qwen-audio-agent 要求的 ${MIN_SIDECAR_VERSION} —— 大概率是跑到了 PATH 上的老 opencode`,
    }
  }
  return { level: "ok", version, note: `opencode ${version}` }
}

// ───────────────────────────── ② DASHSCOPE key ─────────────────────────────

export const DASHSCOPE_PROVIDER_ID = "alibaba-cn"

/**
 * auth.json 路径:**运行时**按 XDG 推导。主进程在 sidecar 启动前已把 `XDG_DATA_HOME` 设成
 * deskfox 命名空间(`data-namespace.ts` 的 `applyDeskfoxDataNamespace`),所以这里 env 优先。
 * 与 `packages/media-gen/src/auth.ts:14` 同一套写法,别再各写各的。
 */
export function resolveAuthJsonPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const dataHome = env.XDG_DATA_HOME || join(home, ".local", "share")
  return join(dataHome, "opencode", "auth.json")
}

/**
 * DeskFox 专属 XDG 默认值 —— **必须与 `../data-namespace.ts` 的 `resolveDeskfoxXdg` 一致**。
 * 这里重写一份而不是 import,是因为 data-namespace.ts 顶层 import 了 `electron-log/main.js`,
 * 在 Electron 之外(测试装置、单测)加载即炸;drift 由 `launch-env.test.ts` 的源码守卫盯着。
 */
export function deskfoxXdgDefaults(home: string = homedir()): { dataHome: string; configHome: string } {
  return {
    dataHome: join(home, ".local", "share", "deskfox"),
    configHome: join(home, ".config", "deskfox"),
  }
}

/**
 * 给**测试装置**补齐 XDG:主进程在 sidecar 起来前会设好这两个变量,而裸终端里跑装置不会 ——
 * 不补的话装置读到的是【旧命名空间】的 auth.json / db,验的根本不是上线后那套环境
 * (2026-08-21 实测踩到:探针读到 `~/.local/share/opencode/auth.json`,而生产是 deskfox 那份)。
 * 已显式设过的一律尊重(power user / 隔离测试)。返回值是补齐后的浅拷贝,不改入参。
 */
export function applyVoiceHarnessXdg(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): NodeJS.ProcessEnv {
  const d = deskfoxXdgDefaults(home)
  return {
    ...env,
    XDG_DATA_HOME: env.XDG_DATA_HOME || d.dataHome,
    XDG_CONFIG_HOME: env.XDG_CONFIG_HOME || d.configHome,
  }
}

interface AuthEntry {
  readonly type?: string
  readonly key?: string
}

/** 读某个 provider 的 API key。读不到 / 解析失败一律 null,由调用方给友好提示。 */
export function readProviderApiKey(
  providerId: string,
  authPath: string = resolveAuthJsonPath(),
  readFile: (p: string) => string | null = (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null),
): string | null {
  const raw = readFile(authPath)
  if (!raw) return null
  try {
    const auth = JSON.parse(raw) as Record<string, AuthEntry>
    const entry = auth?.[providerId]
    if (entry && entry.type === "api" && typeof entry.key === "string" && entry.key.length > 0) return entry.key
    return null
  } catch {
    return null
  }
}

// ───────────────────────────── ③ 三个模型 ─────────────────────────────

/**
 * D-F 定案(1-spec §2.1)。三个位置各自可用 env 覆盖,**换模型不改代码**。
 * - backend:本机真实可用的最强 agentic 档(见文件头 ③ 的可用清单实测)
 * - small:只干标题生成这类杂活(`packages/core/src/v1/config/config.ts:77`),不该烧订阅额度
 * - realtime:qwen-audio-agent 1.11.0 官方默认,audio 族配 smart_turn(对症 spike 的尾巴截断)
 */
export const VOICE_MODEL_DEFAULTS = {
  // 2026-08-22 user 拍板换回 Opus。**换回的前提已经补齐**:
  // 2026-08-21 之所以逃到国产模型,是因为 `claude-code` provider 不把 opencode 的工具透传给
  // claude CLI —— 所有 MCP 工具在它手里都不存在,连带 qwen 的第三层 Session 能力(那五个工具
  // 走 MCP 下发)一起没了。现在 plugin 侧已修(deskfox-plugins/claude-code 的 B1+B2:
  // 静态 MCP 走 `--mcp-config`、动态注册的经 wrapper 旁路文件合并),claude-code 能拿到全部工具。
  //
  // ⚠️ 代价一:**要代理**。claude CLI 直连 Anthropic 会 403,而 DeskFox 从 Dock/Finder 启动时
  //   GUI 进程不继承 shell 的代理变量 —— 那种情况下任务会以
  //   `Failed to authenticate. API Error: 403` 收场(`needsOverseasNetwork` 会在启动日志里预警)。
  // ⚠️ 代价二:走 Claude 订阅额度,不再是国产直连的 API 计费。
  // 换回国产:`DESKFOX_VOICE_BACKEND_MODEL=alibaba-cn/qwen3.8-max`,coordinator 会自动作废重建。
  backend: "claude-code/opus",
  small: "alibaba-cn/qwen-flash",
  realtime: "qwen-audio-3.0-realtime-plus",
  /**
   * voice-acp-bridge 的 coordinator(路由 + 整理播报)档,**刻意不跟 backend 同一个值**。
   *
   * 2026-08-25 真机 QA 的 A/B 实测:coordinator 跑 `claude-code/opus` 时**一次都没派过活** ——
   * 它看不见 MCP 工具,只能自己调 bash/write(被禁后甚至编出「已经写好了」);
   * 同一份 prompt 换成本档,**第一次就正确派活**,第三层 session 落在用户项目里。
   *
   * 根因是老坑复发:`claude-code` provider 把活转给 claude CLI,而 opencode 动态注册的 MCP
   * 传不过去。旧链路靠 `deskfox-acp-wrap.mjs` 的旁路文件合并绕开,而新链路**没有 wrapper**
   * (那正是本次重构消除掉的补丁之一),于是这条老路在新架构上不成立。
   *
   * 选阿里档还有两个顺带好处,都对路由这种轻任务有利:直连不需要代理(claude CLI 要代理,
   * 没有就 403)、延迟与费用都更低 —— 1-spec §3.1 说的"路由是轻任务,可降级小模型"。
   * 第三层任务**不受影响**,照旧跟随 DeskFox 绑定模型(R2/R3 同源)。
   *
   * ⚠️ 换这一档时必须挑**大上下文**的:coordinator 每轮要吞 qwen 那个 ~4.6k 字的请求信封,
   * 小模型会直接 400(`Range of input length should be [1, 13000]`)。
   */
  coordinator: "alibaba-cn/qwen3.8-max",
} as const

/** qwen-audio-agent 1.11.0 `shared/realtime-model-catalog.mjs` 的四个档案。 */
export const KNOWN_REALTIME_MODELS = [
  "qwen3.5-omni-flash-realtime",
  "qwen3.5-omni-plus-realtime",
  "qwen-audio-3.0-realtime-plus",
  "qwen-audio-3.0-realtime-flash",
] as const

/**
 * 认不认识这个 realtime 模型 id。认不出**不拦**(上游随时会加新档),但调用方应当告警 ——
 * qwen 侧对未知 id 会静默回落到 `family: 'unknown'` 档案(能力全 false),那是个哑坑。
 */
export function isKnownRealtimeModel(id: string): boolean {
  return (KNOWN_REALTIME_MODELS as readonly string[]).includes(id)
}

export interface VoiceModels {
  readonly backend: string
  readonly small: string
  readonly realtime: string
  /** voice-acp-bridge 的 coordinator 档;见 VOICE_MODEL_DEFAULTS.coordinator 的注释 */
  readonly coordinator: string
}

export function resolveVoiceModels(env: NodeJS.ProcessEnv = process.env): VoiceModels {
  const pick = (v: string | undefined, fallback: string) => {
    const s = String(v ?? "").trim()
    return s.length > 0 ? s : fallback
  }
  return {
    backend: pick(env.DESKFOX_VOICE_BACKEND_MODEL, VOICE_MODEL_DEFAULTS.backend),
    small: pick(env.DESKFOX_VOICE_SMALL_MODEL, VOICE_MODEL_DEFAULTS.small),
    realtime: pick(env.DESKFOX_VOICE_REALTIME_MODEL, VOICE_MODEL_DEFAULTS.realtime),
    coordinator: pick(env.DESKFOX_VOICE_COORDINATOR_MODEL, VOICE_MODEL_DEFAULTS.coordinator),
  }
}
