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

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { DASHSCOPE_PROVIDER_ID, readProviderApiKey, resolveAuthJsonPath, resolveVoiceModels } from "./launch-env"
import type { VoiceModels } from "./launch-env"
// voice-acp-bridge:新链路要的两样 —— 桥的 Basic 头、跟随当前项目的状态文件路径
import { activeProjectPath } from "./active-project"
import { basicAuthHeader } from "./bridge/env"

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
/**
 * 会话标题生成 prompt(覆盖 opencode 内置的 `agent/prompt/title.txt`)。
 *
 * 内置那版写的是「MUST use the same language as the user message」,但语音链路里**不成立**:
 * 第三层 session 的首条 prompt 是 coordinator 转写过的目标,常常已经是英文,
 * 2026-08-21 真机拿到的标题就是 `Count files in voice-test and writ` —— 中文列表里很扎眼。
 * 这里不跟随、直接硬性要求简体中文。其余约束(单行 / 不解释 / 保留技术词原样)照抄内置版语义。
 */
export const VOICE_TITLE_PROMPT = [
  "你是会话标题生成器,只输出标题本身,不输出任何解释、引号或标点包裹。",
  "",
  "硬性要求:",
  "- **一律使用简体中文**,不管输入是什么语言(这条优先于任何「跟随用户语言」的习惯)",
  "- 单行,不超过 20 个汉字",
  "- 写清楚这次要做的**事**,让人事后能靠它找回这段会话",
  "- 技术名词 / 文件名 / 数字 / 错误码保持原样,不要翻译(如 SQLite、WAL、a.md、500)",
  "- 不要出现工具名(read / bash / edit 之类)",
  "- 不要用「分析」「生成」「总结」这类套话开头,直接说事",
  "- 输入再短也要给出有意义的标题,不要抱怨输入、不要说自己无法生成",
  "",
  "示例:",
  "「统计当前目录有多少个文件」→ 统计目录文件数量",
  "「查一下 SQLite 的 WAL 是什么缩写」→ SQLite WAL 缩写查询",
  "「调研 WAL 模式优缺点并写 wal.md」→ 调研 WAL 优缺点写 wal.md",
  "「线上一直报 500,帮我看看」→ 排查线上 500 报错",
].join("\n")

/**
 * 派活路由引导 —— 让**像样的活**都独立成一条 session,而不是全堆进 coordinator。
 *
 * 起因(2026-08-21 真机):qwen 的路由规则是「新的独立工作 → 建第三层 Session;
 * 其余任务在协调 Session 中执行」,但它的判定阈值偏高 —— 实测「分析今日A股市场盘面」
 * (9 次 macro 工具调用、产出完整分析)都被判成「其余」,留在 coordinator 里。
 * 结果是 coordinator 变成流水账:几十个不相干的任务挤一条,没法读、没法搜,上下文还互相污染。
 * 用户不该靠每次说「新开一个独立任务」这种咒语来触发。
 *
 * 这段经 `config.instructions` 拼进 system prompt(`session/instruction.ts` 支持绝对路径),
 * **不覆盖任何内置 prompt**,只加一段偏好说明。
 *
 * ⚠️ 写成「你手里有这个工具时才适用」——第三层 session 也读同一份 config,
 * 它没有这些工具,读到了也不会误触发。
 */
export const VOICE_ROUTING_INSTRUCTIONS = [
  "<deskfox-voice-routing>",
  "",
  "**先判断你是谁**(这一步错了会造成无限派活,2026-08-22 真机出过:同一件事连开三层 Session):",
  "",
  "- 本轮输入里带 `<qwen_audio_agent_backend_instructions>` 这类请求信封 → 你是**协调者**,适用下面的路由规则。",
  "- 本轮输入是一个**已经写好的任务目标**(没有那个信封,直接就是「调研…」「整理…」这样的指令)",
  "  → 你是**执行者**,已经有人把活派给你了。**直接把它做完**,",
  "  **绝对不要调用 `session_start` / `session_send` 再派一层** —— 那是你上游做过的事,再做一次就是死循环。",
  "",
  "以下规则**只对协调者**生效:",
  "",
  "判断「要不要为这次请求单独开一条 Session」时,**倾向于开**。判据是这件事本身,",
  "不是用户有没有说「新开一个任务」这种话 —— 绝大多数用户不会那么说话。",
  "",
  "**应该单独开一条**(默认走这条):",
  "- 需要多步才能完成:查资料 / 调工具 / 读写文件 / 分析后给结论",
  "- 会产出可交付的东西:文件、报告、一段结论",
  "- 事后可能会被追问、被回看",
  "",
  "**留在协调 Session 里**(少数):",
  "- 一问一答就完的常识或状态查询(几点了、刚才那个任务好了没)",
  "- 对已有工作的控制动作(取消、查进度)",
  "",
  "拿不准时**开新的**。多一条 Session 只是列表里多一行;混进协调 Session 则会污染后续所有判断,",
  "而且那条会话会越滚越长、再也拆不开。",
  "",
  "用户提到之前做过的事、或要在原来基础上继续时,定位并**续接**那条既有 Session,不要另起。",
  "</deskfox-voice-routing>",
].join("\n")

export function buildVoiceConfigContent(models: VoiceModels, instructionsPath?: string): string {
  return JSON.stringify({
    model: models.backend,
    small_model: models.small,
    permission: "allow",
    agent: {
      build: { permission: "allow" },
      // 标题走 small_model,不烧主模型额度;prompt 覆盖见 VOICE_TITLE_PROMPT
      title: { prompt: VOICE_TITLE_PROMPT },
    },
    // merge 语义:这里只**追加**一条路径,用户自己配的 instructions 不受影响
    ...(instructionsPath ? { instructions: [instructionsPath] } : {}),
  })
}

/**
 * 把路由引导落成文件(`config.instructions` 收的是路径不是内容)。
 * 写失败返回空串 —— 拿不到引导顶多是回到旧的判定阈值,不该让语音起不来。
 */
export function writeVoiceInstructionsFile(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  write: (p: string, c: string) => void = (p, c) => {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, c)
  },
): string {
  const stateHome = env.XDG_STATE_HOME || join(home, ".local", "state")
  const file = join(stateHome, "deskfox", "voice-routing.md")
  try {
    write(file, VOICE_ROUTING_INSTRUCTIONS)
    return file
  } catch {
    return ""
  }
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

/**
 * 出网相关的宿主环境 —— 同样必须带,理由同上但表现完全不同。
 *
 * 2026-08-21 真机:语音派活能派出去、任务也跑完了,结果是
 * `Failed to authenticate. API Error: 403 Request not allowed` ——
 * 后端 `claude-code/opus` 会 spawn `claude` CLI,这台机器直连 Anthropic 会被拒,平时靠代理出去。
 * 二分确证:最小 env 复现 403,**只加回代理就恢复**(换 XDG 无影响)。
 *
 * ⚠️ `ALL_PROXY` / `all_proxy` **不在** qwen 的 env 白名单里(`shared/backend-environment.mjs`),
 * 穿不到 ACP 子进程;带上是给 Gateway 进程自己用的。真正管住 `claude` CLI 的是
 * `HTTPS_PROXY` / `https_proxy` 那几个。
 */
const NETWORK_ENV_NAMES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const

function carryNamespaceEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of [...NAMESPACE_ENV_NAMES, ...NETWORK_ENV_NAMES]) {
    const v = base[name]
    if (typeof v === "string" && v.length > 0) out[name] = v
  }
  return out
}

/**
 * 静默多久后回到休眠(秒)。**这就是「对话进行中不用重复唤醒」的实现方式** ——
 * qwen 的 `sleepController` 每次输入都 `recordActivity()` 重置计时,
 * 所以只要你还在说话就一直活跃,停下超过这个时长才需要再喊一次唤醒词。
 *
 * qwen 自己的默认是 `0` = **永不自动休眠**(唤醒一次就一直听),对"不想被日常对话打扰"没用。
 * 180 秒是个折中:一轮问答的思考间隙不会误休眠,离开工位一会儿回来就得重新唤醒。
 * `DESKFOX_VOICE_SLEEP_SECONDS` 可调;设 0 退回 qwen 的永不休眠。
 */
export const VOICE_SLEEP_SECONDS_DEFAULT = 180

/**
 * 唤醒词 + 休眠超时。
 *
 * ⚠️ 唤醒词文案在 qwen 里是**硬编码**的「你好千问」(`core/config.mjs:490`,没有 env 覆盖),
 * 实际检测认的是模型目录下的 `keywords.txt`。想换成别的词得同时改 keywords.txt,
 * 但提示文案仍会说「你好千问」—— 2026-08-21 user 拍板:先沿用「你好千问」,保持文案一致。
 *
 * `DESKFOX_VOICE_WAKE_WORD=off` 可整个关掉(退回"一直在听")。
 */
export function resolveWakeWordEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const off = String(env.DESKFOX_VOICE_WAKE_WORD ?? "").trim().toLowerCase()
  if (off === "off" || off === "0" || off === "false") return {}
  const raw = String(env.DESKFOX_VOICE_SLEEP_SECONDS ?? "").trim()
  const parsed = raw === "" ? Number.NaN : Number(raw)
  // 非法值一律回默认,别把 NaN 塞进 env 让 qwen 那边 clamp 成 0(那等于永不休眠,静默失效)
  const seconds = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : VOICE_SLEEP_SECONDS_DEFAULT
  return {
    QWEN_AUDIO_WAKE_WORD_ENABLED: "true",
    QWEN_AUDIO_DESKTOP_AUTO_HIDE_SECONDS: String(seconds),
  }
}

/** 这个后端模型要不要连境外服务(决定"没代理"该不该提醒;判 provider 前缀,不猜具体模型名) */
export function needsOverseasNetwork(backendModel: string): boolean {
  const provider = String(backendModel ?? "").split("/")[0]
  return ["claude-code", "anthropic", "openai", "google", "github-copilot"].includes(provider)
}

/** 语音专用库文件名(相对名 → core 会 join 到 `Global.Path.data`,跟主实例同一个 XDG 目录) */
export const VOICE_DB_FILENAME = "opencode-voice.db"

/**
 * 语音 ACP 该开哪个库 —— **默认共用主实例那个**(D-A 的本意:语音派的活要在 DeskFox 会话列表里看得见)。
 *
 * 一段来回值得记住:中途曾因为反复 `database is locked` 默认改成独立库,后来查清
 * **那批锁根本不是"共用"造成的** —— 是 spawn env 漏带 XDG 让语音掉进旧命名空间,
 * 开到了别的核心版本写的老库、一开就跑迁移(见 {@link carryNamespaceEnv})。
 * 命名空间修好后共用的是主实例正在用的、**迁移早已完成**的库,启动不再建表,自然不争排他锁。
 * 2026-08-21 user 拍板:必须走 DeskFox 通道、保留会话记录 → 默认回到共用。
 *
 * `DESKFOX_VOICE_ISOLATE_DB=1` 切成独立库 `opencode-voice.db`(会话在 DeskFox 里就看不见了),
 * 留作真撞上库冲突时的逃生口。
 */
export function resolveVoiceDbEnv(env: NodeJS.ProcessEnv, disableChannelDb: boolean): Record<string, string> {
  const isolate = String(env.DESKFOX_VOICE_ISOLATE_DB ?? "").trim()
  if (isolate === "1" || isolate === "true") {
    // 独立:OPENCODE_DB 在 core 里优先级最高(`database.ts:44`),渠道规则不用再管
    return { OPENCODE_DB: VOICE_DB_FILENAME }
  }
  // 共用:抄 `main/server.ts` 给 sidecar 的同一条渠道规则,才落到**同一个文件**
  return disableChannelDb ? { OPENCODE_DISABLE_CHANNEL_DB: "1" } : { OPENCODE_CHANNEL: "local" }
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
    // 路由引导落成文件再由 instructions 引进去(见 VOICE_ROUTING_INSTRUCTIONS)
    OPENCODE_CONFIG_CONTENT: buildVoiceConfigContent(models, writeVoiceInstructionsFile(base)),
    QWEN_AUDIO_REALTIME_MODEL: models.realtime,
    QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE: "full",
    // ── 唤醒词:不叫它就不打扰日常对话(user 2026-08-21 提的需求)
    // qwen 默认 **关**,等于麦克风一开就一直在听。开了之后先进休眠,喊「你好千问」才唤醒;
    // 唤醒后每次说话都会重置计时,所以一轮对话中间不用重复喊。
    // 模型(sherpa-onnx KWS)首次用时自动下载;下不下来只会关掉休眠功能并提示,不影响语音本身
    // (`realtime-gateway.mjs:1670` 的 catch 分支),所以默认开是安全的。
    ...resolveWakeWordEnv(base),
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
  // 需要出海的后端模型 + 一个代理变量都没有 = 大概率 403。不阻塞(有人本来就直连能通),
  // 但要在日志里留一句,省掉下一次"任务跑完了却说没权限"的排查。
  // 注意 DeskFox 从 Dock / Finder 启动时 GUI 进程不继承 shell 的 ~/.zshenv,这里本就可能是空的。
  if (needsOverseasNetwork(models.backend) && !NETWORK_ENV_NAMES.some((n) => String(base[n] ?? "").trim())) {
    warnings.push(
      `后端模型 ${models.backend} 要连境外服务,但没检测到任何代理变量(HTTPS_PROXY 等)——` +
        `若本机需要代理出海,任务会以「Failed to authenticate. API Error: 403」收场。` +
        `从终端 open DeskFox 可继承 shell 的代理设置。`,
    )
  }
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

// ═══════════════════════════ ACP 桥模式(voice-acp-bridge)═══════════════════════════
//
// 上面那套是 voice-dispatch-minimal 的「两套 opencode」形态:qwen 自己 spawn 一个 opencode
// (`--backend opencode` + OPENCODE_BIN 指向 wrapper),与 DeskFox 的 sidecar 只共享 SQLite 文件。
// 由此长出的整片补丁(env carry / stdout 净化 wrapper / DB 渠道分流 / 跨进程强刷列表 / journal 归档)
// 每一条都是这一个结构问题的表象。
//
// 下面是 voice-acp-bridge 的形态:qwen 走**通用 acp backend**,`ACP_COMMAND` 指向我们自己的桥,
// 桥直接对 DeskFox sidecar 说 HTTP。于是语音派出的 session **就是 sidecar 建的**,
// 与手敲的完全同源 —— 上面那些补丁在这条链路上一个都不需要。
//
// 两套代码并存到验收结束(1-spec §6):`DESKFOX_VOICE_LEGACY_BACKEND=1` 整体退回旧链路。

/** 语音沟通(coordinator)session 落哪儿 —— 与用户项目分开,是递归防护的地基(1-spec §3.1)。 */
export function voiceCoordinatorDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const override = String(env.DESKFOX_VOICE_DIR ?? "").trim()
  if (override) return override
  // ⚠️ `XDG_DATA_HOME` 在主进程里**已经是 deskfox 命名空间**(`applyDeskfoxDataNamespace` 设成
  // `~/.local/share/deskfox`),再拼一层 "deskfox" 会出 `deskfox/deskfox/voice-workspace`
  // ——2026-08-24 真机 QA 看到的就是这个。回落值补上那一层,与 launch-env 的 deskfoxXdgDefaults 对齐。
  const dataHome = env.XDG_DATA_HOME || join(home, ".local", "share", "deskfox")
  return join(dataHome, "voice-workspace")
}

/** 走新链路还是旧链路。默认新;出问题时一个 env 退回去,不用改代码重打包。 */
export function useAcpBridge(env: NodeJS.ProcessEnv = process.env): boolean {
  const legacy = String(env.DESKFOX_VOICE_LEGACY_BACKEND ?? "").trim().toLowerCase()
  return !(legacy === "1" || legacy === "true")
}

export interface AcpGatewayEnvInput {
  /** DeskFox 当前窗口的项目目录(给 ACP_WORKSPACE 兜底用;真正的目标目录由桥运行时决定) */
  readonly workspace: string
  /** 桥脚本的绝对路径 —— qwen 把它当可执行文件 spawn */
  readonly bridgePath: string
  /** sidecar 连接信息;拿不到就起不来(桥没法凭空找到随机端口 + 随机密码) */
  readonly server: { readonly url: string; readonly username: string; readonly password: string } | null
  readonly env?: NodeJS.ProcessEnv
  readonly extraPathDirs?: readonly string[]
  readonly authPath?: string
  readonly exists?: (p: string) => boolean
}

/**
 * 构造 ACP 桥模式的 Gateway env。
 *
 * ⚠️ **凭据只进 env,不落盘、不进命令行**(开源仓隐私红线;命令行还会出现在 `ps` 里)。
 *
 * ⚠️ 桥能收到的变量走 qwen 的前缀白名单,**只有 `ACP_` 过得去**
 * (`backend-catalog.mjs:342`)。裸的 `DESKFOX_*` / `OPENCODE_*` 会静默消失 ——
 * 静默,所以必须靠命名规范防住,不是靠记性。
 */
export function buildAcpGatewayEnv(input: AcpGatewayEnvInput): GatewayEnvResult {
  const base = input.env ?? process.env
  const exists = input.exists ?? existsSync
  const models = resolveVoiceModels(base)
  const warnings: string[] = []

  const authPath = input.authPath ?? resolveAuthJsonPath(base)
  const dashscopeKey = readProviderApiKey(DASHSCOPE_PROVIDER_ID, authPath)
  if (!dashscopeKey) {
    warnings.push(`没读到 ${DASHSCOPE_PROVIDER_ID} 的 API key(${authPath}) —— 语音前端起不来,先在设置里连接阿里供应商`)
  }
  if (!input.server) {
    warnings.push("拿不到 DeskFox sidecar 的地址/密码(它还没就绪?)—— 语音桥无法连回 DeskFox")
  }
  if (!exists(input.bridgePath)) warnings.push(`语音桥脚本不存在:${input.bridgePath}`)

  const pathDirs = [...(input.extraPathDirs ?? []), ...String(base.PATH ?? "").split(delimiter)]
  const seen = new Set<string>()
  const mergedPath = pathDirs
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !seen.has(p) && (seen.add(p), true))
    .join(delimiter)

  const voiceDir = voiceCoordinatorDir(base)

  const env: Record<string, string> = {
    // Gateway 进程自己的运行环境。注意这些**不会**穿到桥里(桥只收 ACP_*),
    // 桥要的东西一律走下面的 ACP_DESKFOX_*。
    ...carryNamespaceEnv(base),
    QWEN_AUDIO_REALTIME_MODEL: models.realtime,
    ...resolveWakeWordEnv(base),
    PATH: mergedPath,

    // ── qwen 约定的两个 ──
    ACP_COMMAND: input.bridgePath,
    ACP_WORKSPACE: input.workspace,
    // 桌面端显示用;不设就是 "ACP Agent",在用户面前太不像话
    ACP_LABEL: "DeskFox",

    // ── 桥自己的配置 ──
    ACP_DESKFOX_SERVER_URL: input.server?.url ?? "",
    ACP_DESKFOX_SERVER_AUTH: input.server
      ? basicAuthHeader(input.server.username || "opencode", input.server.password)
      : "",
    ACP_DESKFOX_VOICE_DIR: voiceDir,
    ACP_DESKFOX_ACTIVE_PROJECT_FILE: activeProjectPath(base),
    ACP_DESKFOX_LOG_FILE: voiceBridgeLogPath(base),
    // coordinator 的路由模型,**单独一档、不跟随绑定模型也不跟 backend 同值**。两条真机教训:
    //   ① 跟随绑定模型时,绑了小上下文模型就直接 400(信封 ~4.6k 字);
    //   ② 用 `claude-code/*` 时 coordinator **看不见 MCP 工具、一次都不会派活**
    //      —— claude CLI 拿不到 opencode 动态注册的 MCP,旧链路靠 wrapper 旁路绕开,
    //      而新链路没有 wrapper。详见 VOICE_MODEL_DEFAULTS.coordinator 的注释。
    // `DESKFOX_VOICE_COORDINATOR_MODEL` 可覆盖;第三层任务仍跟随绑定模型,同源性不受影响。
    ACP_DESKFOX_COORDINATOR_MODEL: models.coordinator,
    // 第三层任务的模型:**钉死强模型档**(user 2026-08-25 拍板 Opus 5),
    // 不再跟随 DeskFox 绑定 —— 跟随绑定在全新环境下会挑到荒唐的模型
    // (真机撞到过 `tongyi-intent-detect-v3` 意图识别档,任务 100% 失败),
    // 而语音场景里用户看不见也换不了。详见 VOICE_MODEL_DEFAULTS.task。
    // `DESKFOX_VOICE_TASK_MODEL` 可覆盖。
    ACP_DESKFOX_TASK_MODEL: models.task,
  }
  if (dashscopeKey) env.DASHSCOPE_API_KEY = dashscopeKey

  // ⚠️ **不设** `QWEN_AUDIO_AGENT_BACKEND_PERMISSION_MODE=full`。通用 acp backend 的
  // `supportsFullPermission: false`,CLI 层会直接拒绝启动(`cli/src/arguments.mjs:265-276`)。
  // 这不构成限制:ACP 的权限请求是**桥主动发起**的,桥对语音派活场景根本不发,
  // 等价于全放行且没有确认打扰;真正的权限边界由 sidecar 自己的 agent 配置管(1-spec §3.6)。

  // ⚠️ 也**不设** `OPENCODE_CONFIG_CONTENT` 那套模型注入。第三层 session 由 sidecar 创建,
  // 用的就是 DeskFox 当前绑定的模型 —— 这正是"与手敲 session 无差别"(R2/R3)的含义。

  if (needsOverseasNetwork(models.backend) && !NETWORK_ENV_NAMES.some((n) => String(base[n] ?? "").trim())) {
    warnings.push(
      `DeskFox 当前绑定的模型可能要连境外服务,但没检测到任何代理变量(HTTPS_PROXY 等)。` +
        `从终端 open DeskFox 可继承 shell 的代理设置。`,
    )
  }
  return { env, warnings }
}

/** 桥自己的日志(与网关日志分开,一眼能分清是谁在说话)。 */
export function voiceBridgeLogPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const stateHome = env.XDG_STATE_HOME || join(home, ".local", "state")
  return join(stateHome, "deskfox", "voice-bridge.log")
}
