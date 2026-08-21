// [fork-only] REQ-102 语音派活 — Gateway 启动参数固化 [feat: voice-dispatch-minimal] 2026-08-21
//
// 把"每次手敲一串 env"变成一处可测的构造函数。S2 的全部意义就是**不靠人记着**:
// spike 时代那串参数散在 shell history 里,机器一重启就没了,重装 qwen-audio-agent 又会
// 冲掉手工 patch —— 那些都是"自用期间会突然失效"的暗雷。
//
// 三条实测结论钉在这里(2026-08-21,隔离环境跑出来的,不是推断):
//
//   ① `OPENCODE_CONFIG_CONTENT` 是 **merge 且优先级最高**(`config.ts:468-476` 的
//      `merge(source, next, "local")` 最后合入)。所以我们只声明要覆盖的键,配置文件里的
//      plugin / provider 段照常生效 —— media-gen 在语音里还在,就是靠这个。
//
//   ② 注入的 `model` **确实生效**,但只认【这台机器上真实可用的】模型 id:
//      `acp/service.ts:785` 的 `defaultModelFromConfig` 会先校验 `providers[p]?.models[m]`,
//      校验不过就**静默回落**到默认档(spike 里那个 `opencode/big-pickle` 就是这么来的)。
//      顶层 `model` 就够,不需要再写 `agent.<name>.model`。
//
//   ③ qwen 侧的 `QWEN_AUDIO_AGENT_BACKEND_MODEL` **不能用来选模型**:它会把值强行拼成
//      `alibaba-cn/<name>`(`server/src/core/config.mjs:80`),只能选阿里系。我们走 ①。

import { existsSync } from "node:fs"
import { delimiter, dirname, join } from "node:path"
import { DASHSCOPE_PROVIDER_ID, readProviderApiKey, resolveAuthJsonPath, resolveVoiceModels } from "./launch-env"
import type { VoiceModels } from "./launch-env"

/** Gateway 默认端口(qwen `shared/backend-catalog.mjs`)。 */
export const GATEWAY_PORT = 3101
/** 语音链路里 opencode 托管 server 的端口 —— 刻意避开默认 4096,不跟主实例撞。 */
export const VOICE_OPENCODE_PORT = 4396

/**
 * 注入给 ACP 的 config。`permission` 顶层 + agent 层都给:
 * qwen 的 `--backend-permission-mode full` 自己也会拼一份(agent 层写字符串简写),
 * 而 fork 1.18.16 的 `permission.ts:40` `normalizeInput` 收字符串 —— 2026-08-21 实测无 schema 报错,
 * **1.17.4 时代那行手工 patch 已永久不需要**。
 */
export function buildVoiceConfigContent(models: VoiceModels): string {
  return JSON.stringify({
    model: models.backend,
    small_model: models.small,
    permission: "allow",
    agent: { build: { permission: "allow" } },
  })
}

export type WorkspaceCheck =
  | { readonly ok: true; readonly dir: string }
  | { readonly ok: false; readonly dir: string; readonly reason: string }

/**
 * R3 护栏:派活目标**只允许 git 仓库根**。
 * 理由不是洁癖 —— D-C 让语音在真实项目里跑 full 权限,而 ASR 实测有截断
 * (「…然后告诉我一共有。」尾巴丢),误识别会直接落到真代码上。git 是最后一道撤销。
 * 非 git 目录一律拒绝启动,而不是降级成"就地干活"。
 */
export function checkVoiceWorkspace(dir: string, exists: (p: string) => boolean = existsSync): WorkspaceCheck {
  const d = String(dir ?? "").trim()
  if (!d) return { ok: false, dir: d, reason: "没有打开项目 —— 语音派活需要一个目标目录" }
  if (!exists(d)) return { ok: false, dir: d, reason: `目录不存在:${d}` }
  if (!exists(join(d, ".git"))) {
    return { ok: false, dir: d, reason: `不是 git 仓库根:${d}(语音会以全开权限改文件,必须留 git 作撤销手段)` }
  }
  return { ok: true, dir: d }
}

export interface GatewayEnvInput {
  /** DeskFox 当前窗口的项目目录 */
  readonly workspace: string
  /** fork 仓根(wrapper 要用它定位 1.x 源码入口) */
  readonly repoRoot: string
  /** wrapper 脚本绝对路径 */
  readonly wrapperPath: string
  /** 主进程 env(已含 data-namespace 设好的 XDG) */
  readonly env?: NodeJS.ProcessEnv
  /** 需要补进 PATH 的可执行目录(bun / claude CLI 等),按序去重前置 */
  readonly extraPathDirs?: readonly string[]
  readonly authPath?: string
  readonly exists?: (p: string) => boolean
  /**
   * **只在 `DESKFOX_VOICE_SHARE_DB=1`(共用库)那条路上生效** —— 用来对齐主实例开的是哪个文件。
   * 取值抄 `main/server.ts:244` 给 sidecar 的同一条规则:发布渠道 → true(共用 `opencode.db`);
   * 未打包 / local 档 → false(各自 `opencode-<channel>.db`)。对齐不上会有两个后果:
   * 会话落到另一个库(D-A 的可见性归零)、或那个库是别的核心版本写的一开就触发迁移
   * (2026-08-21 真机:源码态默认落 `opencode-local.db`,迁移 `INSERT INTO __new_project_directory`
   * 直接失败 —— app 的 orphan-prune / db-schema-guard 只在主进程跑,CLI 路径一个都没有)。
   * 默认路径(独立库)不看这个字段,见 {@link resolveVoiceDbEnv}。
   */
  readonly disableChannelDb: boolean
}

/**
 * 必须原样带进 spawn env 的"我是谁、我的家在哪"变量。
 * `HOME` 少了 → `os.homedir()` 回落 passwd,XDG_* 少了 → 回落 `~/.local/share/opencode`,
 * 两者都会让语音离开 DeskFox 命名空间(auth / 会话 / db 全部错位)。
 */
const NAMESPACE_ENV_NAMES = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "XDG_DATA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
] as const

function carryNamespaceEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of NAMESPACE_ENV_NAMES) {
    const v = base[name]
    if (typeof v === "string" && v.length > 0) out[name] = v
  }
  return out
}

/** 语音专用库文件名(相对名 → core 会 join 到 `Global.Path.data`,跟主实例同一个 XDG 目录) */
export const VOICE_DB_FILENAME = "opencode-voice.db"

/**
 * 语音 ACP 该开哪个库。
 *
 * **默认独立库**(`opencode-voice.db`)。D-A 原本想共用主实例的库换「会话在 DeskFox 里看得见」,
 * 但 2026-08-21 真机把 1-spec §5·R1 的风险打实了:opencode 启动阶段跑迁移要拿排他锁,
 * 主实例(用户长期开着的正式版 / 本地版)正握着同一个文件 → `database is locked` → 宿主 exit 1
 * → Gateway 起不来。加了退避重试仍不稳:主实例在跑时基本必失败。
 * 换独立库后同条件实测 3/3 起得来。**能用 > 能看见**,所以默认让步。
 *
 * `DESKFOX_VOICE_SHARE_DB=1` 切回共用(拿会话可见性,代价是可能起不来),留给 D-A 复议。
 */
export function resolveVoiceDbEnv(env: NodeJS.ProcessEnv, disableChannelDb: boolean): Record<string, string> {
  const share = String(env.DESKFOX_VOICE_SHARE_DB ?? "").trim()
  if (share === "1" || share === "true") {
    // 共用:抄 `main/server.ts` 给 sidecar 的同一条渠道规则,才落到同一个文件
    return disableChannelDb ? { OPENCODE_DISABLE_CHANNEL_DB: "1" } : { OPENCODE_CHANNEL: "local" }
  }
  // 独立:OPENCODE_DB 在 core 里优先级最高(`database.ts:44`),渠道规则不用再管
  return { OPENCODE_DB: VOICE_DB_FILENAME }
}

export interface GatewayEnvResult {
  readonly env: Record<string, string>
  /** 拿不到 DashScope key 时非空 —— 调用方据此提示,而不是让 Gateway 起来后才报错 */
  readonly warnings: readonly string[]
}

/**
 * 构造拉起 Gateway 用的完整 env。**幂等、纯**(IO 只有读 auth.json,可注入)。
 * PATH 会被前置补一段:wrapper 的 shebang 要找得到 `bun`;`claude-code` provider 要找得到
 * `claude` CLI —— GUI 进程的 PATH 常常两个都没有,漏了就是"点了图标起不来"。
 */
export function buildGatewayEnv(input: GatewayEnvInput): GatewayEnvResult {
  const base = input.env ?? process.env
  const exists = input.exists ?? existsSync
  const models = resolveVoiceModels(base)
  const warnings: string[] = []

  const authPath = input.authPath ?? resolveAuthJsonPath(base)
  const dashscopeKey = readProviderApiKey(DASHSCOPE_PROVIDER_ID, authPath)
  if (!dashscopeKey) {
    warnings.push(`没读到 ${DASHSCOPE_PROVIDER_ID} 的 API key(${authPath}) —— 语音前端起不来,先在设置里连接阿里供应商`)
  }

  const pathDirs = [...(input.extraPathDirs ?? []), ...String(base.PATH ?? "").split(delimiter)]
  const seen = new Set<string>()
  const mergedPath = pathDirs
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !seen.has(p) && (seen.add(p), true))
    .join(delimiter)

  const env: Record<string, string> = {
    // ── 命名空间(D-A 的地基,漏了就全盘错位)
    // 我们是**整份替换** spawn env(不继承 process.env),所以 XDG/HOME 必须显式带过去。
    // 2026-08-21 真机漏了这段的后果:Gateway 及其拉起的 opencode 全部回落到系统默认
    // `~/.local/share/opencode/` —— auth.json 读的是旧命名空间(凭据可能过期)、
    // 会话落到 DeskFox 看不见的库、而且那个库是**别的核心版本**写的,一开就跑迁移,
    // 于是 `INSERT INTO __new_project_directory` 失败 / `database is locked` 全是这一个根因的表象。
    // qwen 的 env 白名单(`shared/backend-environment.mjs`)本来就放行 XDG_*/HOME,
    // 一路能穿到 ACP 子进程 —— 前提是 Gateway 自己身上有。
    ...carryNamespaceEnv(base),
    // ── ACP 宿主(D-E/D-G):qwen 把 OPENCODE_BIN 当可执行文件 spawn
    OPENCODE_BIN: input.wrapperPath,
    // ⚠️ 前缀不是洁癖:qwen 给 ACP 子进程的 env 是白名单过滤的(`backend-environment.mjs:75`),
    // opencode 后端只放行 `OPENCODE_` 前缀 + 三个具名变量。裸的 DESKFOX_* 传不进去
    // (2026-08-21 真机实测:wrapper 报"未配置 fork 仓路径")。两个都给:
    // 不带前缀的给 Gateway 进程自己用,带前缀的才穿得到 ACP 子进程。
    DESKFOX_VOICE_REPO_ROOT: input.repoRoot,
    OPENCODE_DESKFOX_VOICE_REPO_ROOT: input.repoRoot,
    // ── 派活目标(D-C):跟随 DeskFox 当前项目
    OPENCODE_WORKSPACE: input.workspace,
    // ── 模型 + 权限(D-F,merge 进用户配置,只覆盖这几个键)
    OPENCODE_CONFIG_CONTENT: buildVoiceConfigContent(models),
    QWEN_AUDIO_REALTIME_MODEL: models.realtime,
    QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: "full",
    // ── 端口:避开主实例的默认 4096。
    // ⚠️ 只设 OPENCODE_PORT 不够 —— qwen 的 `applyAddress`(`backend-drivers/opencode.mjs`)
    // 会按 `OPENCODE_BASE_URL`(默认 http://127.0.0.1:4096)反算并覆盖端口,
    // 2026-08-21 真机实测:宿主实际 listening 在 4096。两个一起给才压得住。
    OPENCODE_PORT: String(VOICE_OPENCODE_PORT),
    OPENCODE_BASE_URL: `http://127.0.0.1:${VOICE_OPENCODE_PORT}`,
    // ── db:默认独立库,`DESKFOX_VOICE_SHARE_DB=1` 切回共用(见 resolveVoiceDbEnv)
    ...resolveVoiceDbEnv(base, input.disableChannelDb),
    PATH: mergedPath,
  }
  if (dashscopeKey) env.DASHSCOPE_API_KEY = dashscopeKey
  // 插件白名单覆盖同理要带前缀才穿得过去;wrapper 会翻译回 DESKFOX_ACP_PLUGINS
  const pluginsOverride = String(base.DESKFOX_ACP_PLUGINS ?? "").trim()
  if (pluginsOverride) env.OPENCODE_DESKFOX_ACP_PLUGINS = pluginsOverride
  // 空值不塞:qwen 侧对空串和未设的处理不一样,少一个歧义源
  if (exists(input.wrapperPath) === false) warnings.push(`wrapper 不存在:${input.wrapperPath}`)

  return { env, warnings }
}

/** 从一个可执行文件路径取它所在目录(给 extraPathDirs 用);空值返回 undefined。 */
export function binDir(execPath: string | undefined): string | undefined {
  const p = String(execPath ?? "").trim()
  return p ? dirname(p) : undefined
}
