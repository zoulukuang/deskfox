// [fork-only] voice-acp-bridge — qwen-audio-agent 侧契约快照 [feat: voice-acp-bridge] 2026-08-24
//
// 桥走的是 qwen 的**官方扩展点**(通用 `acp` backend + `ACP_COMMAND` 指向任意命令),
// 但那个扩展点没有版本承诺 —— 工具名、信封标记、env 白名单都可能在它升级时漂。
// 1-spec §5 把这条列为「中」风险,缓解手段就是本文件:把契约集中成常量 + 一组快照断言,
// **漂了先让测试红,而不是让语音在用户面前静默失灵**。
//
// 每条常量都标了 qwen 1.11.0 的出处行号,升级后按图索骥即可复核。
// 路径前缀 = `<npm global>/qwen-audio-agent/`。

/** 本桥对齐的 qwen-audio-agent 版本(升级后先跑 contract.test.ts 再改这里)。 */
export const QWEN_CONTRACT_VERSION = "1.11.0"

/**
 * ACP 协议版本号。`acp-process-client.mjs:233-242` 严格 `!== 1` 即抛「协议版本不兼容」
 * 并杀掉整个进程树 —— 这是唯一一个回错就彻底起不来的字段。
 */
export const ACP_PROTOCOL_VERSION = 1

// ───────────────────────────── MCP:Gateway 的第三层派活工具 ─────────────────────────────

/**
 * qwen 注册给 **coordinator session** 的 MCP server 名(`acp-session-tools.mjs:9`)。
 *
 * 这个名字在桥里有双重身份:既是要转译给 sidecar 的 server 名,**也是判定
 * 「这条 session/new 是不是 coordinator」的结构性判据**(见 sessions.ts)——
 * 第三层 session 的 mcpServers 里只有 builtin,永远没有它。
 */
export const QWEN_MCP_SERVER_NAME = "qwen_audio_agent"

/**
 * 五个派活工具的**完整名字**(`acp-session-tools.mjs:10-16`)。名字自带 `qwen_audio_agent_` 前缀,
 * 与 server 名重复是 qwen 的既定形态,不要自作主张去前缀。
 */
export const QWEN_MCP_TOOL_NAMES = [
  "qwen_audio_agent_sessions_list",
  "qwen_audio_agent_session_start",
  "qwen_audio_agent_session_send",
  "qwen_audio_agent_session_status",
  "qwen_audio_agent_session_cancel",
] as const

/**
 * 两个关键工具的必填参数(`acp-session-tools.mjs:55-90`)。
 * ⚠️ `session_start` 收的是 **`prompt`**,不是 `objective` —— 实验里按直觉写 objective 调不通,
 * 这类「名字看起来对但不是」的漂移正是快照测试要钉死的东西。
 */
export const QWEN_MCP_TOOL_REQUIRED_ARGS: Readonly<Record<string, readonly string[]>> = {
  qwen_audio_agent_session_start: ["prompt"],
  qwen_audio_agent_session_send: ["session_id", "prompt"],
}

// ───────────────────────────── 信封标记 ─────────────────────────────

/**
 * 请求信封 —— coordinator 每一轮 prompt 都会被包上(`acp-backend-adapter.mjs:949/952`)。
 * 标记**独占一行**,由 `transformPromptText` prepend 到第一个 text block 最前面。
 */
export const ENVELOPE_BACKEND_INSTRUCTIONS_OPEN = "<qwen_audio_agent_backend_instructions>"
export const ENVELOPE_BACKEND_INSTRUCTIONS_CLOSE = "</qwen_audio_agent_backend_instructions>"

/**
 * 结果回流信封 —— 第三层任务跑完后,Gateway 把结果塞回 coordinator 让它整理成播报
 * (`acp-backend-adapter.mjs:1141/1149`)。
 *
 * **这个标记是递归防护的核心判据**:带它的轮次是「收尾」,绝不能再派活。
 * 实验 E4 里只判 backend_instructions 就把收尾轮误判成新任务,mock 自己递归开出了第三条 session ——
 * 与生产上「一件事 3 个 session」是同一个坑。见 turn.ts。
 */
export const ENVELOPE_DELEGATION_RESULT_OPEN = "<qwen_audio_agent_delegation_result>"
export const ENVELOPE_DELEGATION_RESULT_CLOSE = "</qwen_audio_agent_delegation_result>"

// ───────────────────────────── session/update 白名单 ─────────────────────────────

/**
 * qwen 真正会消费的 `sessionUpdate` 取值(`acp-backend-session-utils.mjs:91-140`)。
 * 其余合法值它解析得了但 `activityFromUpdate` 返回 null(不产生进度),
 * **非法值则整条通知被 zod 静默丢弃**(`acp.js` SessionUpdateRouter)——
 * 丢的是我们的内容,而且不报错,所以只发这几种。
 */
export const CONSUMED_SESSION_UPDATES = ["agent_message_chunk", "plan", "tool_call", "tool_call_update"] as const

/**
 * `session/prompt` 的合法 stopReason(SDK `zod.gen.js:1531-1537`)。
 * 客户端只对 `cancelled` 特殊处理(抛取消),其余一律当成功。
 */
export const STOP_REASONS = ["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"] as const
export type StopReason = (typeof STOP_REASONS)[number]

// ───────────────────────────── env 契约 ─────────────────────────────

/**
 * qwen 给 ACP 子进程的 env 走**前缀白名单**:通用 acp backend 只放行 `ACP_`
 * (`backend-catalog.mjs:342` + `backend-environment.mjs:80`)。
 *
 * 直接后果,写在这里免得下次又踩:
 *   · `DASHSCOPE_API_KEY` / `OPENCODE_*` **穿不过来**(那是 opencode backend 的白名单);
 *   · 我们自己的一切配置必须叫 `ACP_DESKFOX_*`,裸的 `DESKFOX_*` 会静默消失。
 */
export const ACP_ENV_PREFIX = "ACP_"

/** qwen 自己约定的两个(`shared/backend-catalog.mjs:329/333`、`server/src/core/config.mjs:312-320`)。 */
export const ENV_ACP_COMMAND = "ACP_COMMAND"
export const ENV_ACP_WORKSPACE = "ACP_WORKSPACE"

/** 桥自己的配置,全部 `ACP_DESKFOX_` 前缀。凭据只经 env 传,不落盘、不进命令行(开源仓隐私红线)。 */
export const ENV_SERVER_URL = "ACP_DESKFOX_SERVER_URL"
export const ENV_SERVER_AUTH = "ACP_DESKFOX_SERVER_AUTH"
export const ENV_VOICE_DIR = "ACP_DESKFOX_VOICE_DIR"
/**
 * coordinator 的路由模型,形如 `provider/model`;空则跟随 DeskFox 绑定的模型。
 *
 * 为什么 coordinator 要单独配一档(2026-08-24 真机 QA 打出来的):
 * **它的输入天然很大** —— qwen 每轮都会包一个 ~4.6k 字的请求信封(backend_instructions +
 * 协调协议 + 用户偏好/记忆/最近语音上下文),再加 opencode 自己的 system prompt。
 * 跟随绑定模型时,只要用户绑的是小上下文模型就直接 400:
 *   `InternalError.Algo.InvalidParameter: Range of input length should be [1, 13000]`
 * ——语音链路整个哑掉,而用户完全不知道为什么。
 *
 * 第三层任务**不受此约束**(它拿到的是一句干净的任务文本),继续跟随绑定模型,
 * 「与手敲 session 无差别」(1-spec R2/R3)因此不受影响。
 */
export const ENV_COORDINATOR_MODEL = "ACP_DESKFOX_COORDINATOR_MODEL"

/**
 * 第三层任务的模型,形如 `provider/model`;**默认空 = 跟随 DeskFox 绑定的模型**
 * (1-spec R2/R3:任务 session 与手敲的同源)。
 *
 * 留这个口子是因为 2026-08-25 真机 QA 撞到的一幕:local 包是全新隔离 DB、共享 config 里也没有
 * `model` 字段,于是 opencode 的默认档挑中了 `alibaba-cn/tongyi-intent-detect-v3` ——
 * 一个**意图识别小模型**,既吞不下 system prompt(13000 上限)也不会干活,
 * 语音任务 100% 失败。绑过模型的正式版不会这样,但"全新环境开箱即坏"这件事本身
 * 需要一个不改共享配置就能绕开的出口(改 config 会波及用户正在用的实例)。
 */
export const ENV_TASK_MODEL = "ACP_DESKFOX_TASK_MODEL"
export const ENV_ACTIVE_PROJECT_FILE = "ACP_DESKFOX_ACTIVE_PROJECT_FILE"
export const ENV_LOG_FILE = "ACP_DESKFOX_LOG_FILE"

/**
 * 一次性校验「我们对 qwen 的假设还成立吗」。桥启动时跑一次,不符即**报错退出**而不是静默降级 ——
 * 1-spec §5 要的就是这个:契约漂移要在启动那一刻炸出来,别等用户对着麦克风说完话才发现没反应。
 *
 * 只校验能在**不启动 qwen** 的前提下自查的部分(工具名/信封/更新类型的自洽性);
 * 真正的 qwen 侧 schema 由 `contract.test.ts` 对着安装目录做快照。
 */
export function assertContractSelfConsistent(): void {
  const problems: string[] = []
  for (const name of QWEN_MCP_TOOL_NAMES) {
    if (!name.startsWith(`${QWEN_MCP_SERVER_NAME}_`)) {
      problems.push(`工具名 ${name} 不是 ${QWEN_MCP_SERVER_NAME}_ 前缀`)
    }
  }
  for (const tool of Object.keys(QWEN_MCP_TOOL_REQUIRED_ARGS)) {
    if (!(QWEN_MCP_TOOL_NAMES as readonly string[]).includes(tool)) {
      problems.push(`必填参数表引用了未知工具 ${tool}`)
    }
  }
  for (const name of [
    ENV_SERVER_URL,
    ENV_SERVER_AUTH,
    ENV_VOICE_DIR,
    ENV_ACTIVE_PROJECT_FILE,
    ENV_LOG_FILE,
    ENV_COORDINATOR_MODEL,
    ENV_TASK_MODEL,
  ]) {
    if (!name.startsWith(ACP_ENV_PREFIX)) problems.push(`${name} 不是 ${ACP_ENV_PREFIX} 前缀,穿不过 qwen 的 env 白名单`)
  }
  if (problems.length) throw new Error(`[voice-bridge] 契约自检失败:\n- ${problems.join("\n- ")}`)
}
