// [fork-only] voice-acp-bridge — 桥的启动配置(ACP_* env 契约) [feat: voice-acp-bridge] 2026-08-24
//
// 桥是 qwen spawn 的子进程,拿不到 DeskFox 主进程的任何上下文 —— 它对世界的全部认知就是这几个 env。
// 而 qwen 的 env 白名单只放行 `ACP_` 前缀(contract.ts 有出处),所以配置名一律 `ACP_DESKFOX_*`。
//
// **缺配置一律启动即失败,并且报人话。** 这条是 1-spec §7 TC-U7 明确要求的:
// 静默跑偏的后果是用户对着麦克风说完话、等了半天、什么都没发生,而日志里只有一句 fetch 失败。
// 宁可在 `qwenaudio setup` 那一刻就红,也不要在用户面前哑掉。

import { ENV_ACTIVE_PROJECT_FILE, ENV_LOG_FILE, ENV_SERVER_URL, ENV_SERVER_AUTH, ENV_VOICE_DIR } from "./contract"

export interface BridgeConfig {
  /** sidecar 地址,如 `http://127.0.0.1:53412`。**端口是随机的**(主进程 `index.ts:499` 取空闲端口),不能硬编码。 */
  readonly serverUrl: string
  /** `Authorization` 头的完整值(`Basic <base64>`)。凭据只经 env 传,不落盘、不进命令行。 */
  readonly authorization: string
  /** coordinator session 落哪个目录 —— 与用户项目分开,是递归防护的地基(1-spec §3.1)。 */
  readonly voiceDir: string
  /** DeskFox「当前打开的项目」状态文件;读不到就回落 qwen 给的 cwd(见 active-project.ts)。 */
  readonly activeProjectFile: string
  /** 桥自己的日志文件;空表示只写 stderr。 */
  readonly logFile: string
}

/** 把 `opencode:密码` 编成 Basic 头。sidecar 的校验见 `packages/opencode/src/server/auth.ts:28-34`。 */
export function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`
}

/**
 * 解析并校验 env。缺必填项抛错,消息里**带上变量名和它该是什么** ——
 * 桥的错误最终会被 qwen 收进 stderr 再拼进用户可见的报错(`acp-process-client.mjs:124-129`),
 * 所以这句话是排查的第一现场,值得写清楚。
 */
export function readBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const missing: string[] = []
  const pick = (name: string, hint: string): string => {
    const v = String(env[name] ?? "").trim()
    if (!v) missing.push(`${name}(${hint})`)
    return v
  }
  const serverUrl = pick(ENV_SERVER_URL, "DeskFox sidecar 地址,如 http://127.0.0.1:53412")
  const authorization = pick(ENV_SERVER_AUTH, "sidecar 的 Authorization 头,形如 Basic <base64>")
  const voiceDir = pick(ENV_VOICE_DIR, "coordinator session 的独立目录")
  if (missing.length) {
    throw new Error(
      `[voice-bridge] 启动配置缺失,语音桥无法连上 DeskFox:\n- ${missing.join("\n- ")}\n` +
        `这些值由 DeskFox 主进程在启动语音网关时注入(launch-config.ts);` +
        `手工跑桥做调试时需要自己 export。`,
    )
  }
  return {
    serverUrl: serverUrl.replace(/\/+$/, ""),
    authorization,
    voiceDir,
    activeProjectFile: String(env[ENV_ACTIVE_PROJECT_FILE] ?? "").trim(),
    logFile: String(env[ENV_LOG_FILE] ?? "").trim(),
  }
}
