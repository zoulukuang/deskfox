export type ConfigInvalidError = {
  name: "ConfigInvalidError"
  data: {
    path?: string
    message?: string
    issues?: Array<{ message: string; path: string[] }>
  }
}

export type ProviderModelNotFoundError = {
  name: "ProviderModelNotFoundError"
  data: {
    providerID: string
    modelID: string
    suggestions?: string[]
  }
}

// FORK: 后端不可达(连接级)瞬时错识别 [feat: coldstart-toast-race] 2026-06-08
// sidecar 假死 / 被看门狗(REQ-049 Layer③)重启的窗口里,所有请求都以连接级错误失败:
//   - Tauri/reqwest 路径:`error sending request for url (...)`(实测截图里就是这条)
//   - web fetch 路径:`Failed to fetch` / `NetworkError` 等
// 这类"后端暂时不可达"由看门狗统一出"后台引擎重启中 / 后台已恢复"提示并自动同 port 重启恢复,
// 各请求站点不应再各弹一条红 toast(冗余噪音)。识别后在 toast 站点 suppress(仍 console 记录)。
// 仅 match 连接级不可达 —— 不含 HTTP 4xx/5xx(那是后端在、业务/服务故障,应正常 surface)。
const BACKEND_UNREACHABLE_RE =
  /error sending request|failed to fetch|networkerror|connection refused|econnrefused|tcp connect error|connection closed before message completed/i

export function isBackendUnreachableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  if (!msg) return false
  return BACKEND_UNREACHABLE_RE.test(msg)
}

// FORK: 冷启动瞬时态(含项目重载)识别 [feat: coldstart-project-reload-toast] 2026-06-09
// 比 isBackendUnreachableError 多覆盖一类冷启动产物:tanstack-query 的 "Missing queryFn"。
// 起因:启动重载上次项目(如 OPENCODE-PLAN)时,bootstrap 在 sidecar 后端 ready 前抢跑,
// 弹两条"无法重新加载 <项目>":① providers 查询 `Missing queryFn`(sdk 未 ready → queryFn=skipToken,
// fetchQuery 抛)② agent 查询 `error sending request`(连接级不可达)。两者都是 transient、sdk/后端
// ready 后重跑即恢复,不该弹红 toast。连接级不可达仍交看门狗统管恢复 UX(见 isBackendUnreachableError)。
export function isTransientStartupError(error: unknown): boolean {
  if (isBackendUnreachableError(error)) return true
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  if (!msg) return false
  // tanstack-query 对 skipToken 查询 fetchQuery 时抛 "Missing queryFn: '[...]'"
  return /missing queryfn/i.test(msg)
}

// FORK: 冷启动 file.list 瞬时 500 识别 [feat: coldstart-list-500-retry] 2026-06-13
// 起因:sidecar HTTP 已起但内部(文件索引 / instance / worktree)未热,首个 file.list 返回
//   500「Unexpected server error. Check server logs for details.」,稍后自愈(树最终正常加载)。
// 这是 transient 500(非连接级不可达,故 isBackendUnreachableError 漏判),应重试而非各弹红 toast。
// 仅匹配该通用 500 文案 —— 真实业务 5xx 带具体错误信息,不命中此正则,仍正常 surface。
const TRANSIENT_SERVER_ERROR_RE = /unexpected server error|check server logs for details/i
export function isTransientServerError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  if (!msg) return false
  return TRANSIENT_SERVER_ERROR_RE.test(msg)
}

/** file.list 可重试错误 = 连接级不可达 OR 冷启动瞬时 500。其余(真实业务错)立即 surface 不延迟。 */
export function isRetryableListError(error: unknown): boolean {
  return isBackendUnreachableError(error) || isTransientServerError(error)
}

// FORK: 目录不可服务识别 [feat: project-continuity-v2026-8-4] 2026-07-05
// 切到目录已被删除/改名/挪走(且无法 relocate)的项目时,后端为该缺失目录 boot 实例失败,
// /file 返回「Server returned 503 with empty body」。文件树已就地显「加载文件树失败 · 重试」占位,
// 右下角再弹一条原始 503 toast = 冗余噪音(且每次切项目都弹)→ suppress 该 toast(仍 console 记录、
// 占位保留可重试)。仅匹配 503 空 body 这一「缺失目录」签名 —— 真实业务 5xx 带具体错误信息不命中,照常 surface。
// 非「可重试」:目录真没了,重试也不会好,故独立于 isRetryableListError(不触发无谓退避重试)。
const UNSERVABLE_DIR_RE = /returned 503 with empty body/i
export function isUnservableDirError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  if (!msg) return false
  return UNSERVABLE_DIR_RE.test(msg)
}

type Translator = (key: string, vars?: Record<string, string | number>) => string

function tr(translator: Translator | undefined, key: string, text: string, vars?: Record<string, string | number>) {
  if (!translator) return text
  const out = translator(key, vars)
  if (!out || out === key) return text
  return out
}

export function formatServerError(error: unknown, translate?: Translator, fallback?: string) {
  const unwrapped = unwrapNamedError(error)
  if (isConfigInvalidErrorLike(unwrapped)) return parseReadableConfigInvalidError(unwrapped, translate)
  if (isProviderModelNotFoundErrorLike(unwrapped)) return parseReadableProviderModelNotFoundError(unwrapped, translate)
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  if (fallback) return fallback
  return tr(translate, "error.chain.unknown", "Unknown error")
}

function unwrapNamedError(error: unknown): unknown {
  if (error instanceof Error && error.cause && typeof error.cause === "object" && "body" in error.cause) {
    return (error.cause as Record<string, unknown>).body
  }
  return error
}

export function isSessionNotFoundError(error: unknown, sessionID: string) {
  const unwrapped = unwrapNamedError(error)
  if (typeof unwrapped !== "object" || unwrapped === null) return false
  const value = unwrapped as Record<string, unknown>
  return value._tag === "SessionNotFoundError" && value.sessionID === sessionID
}

function isConfigInvalidErrorLike(error: unknown): error is ConfigInvalidError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ConfigInvalidError" && typeof o.data === "object" && o.data !== null
}

function isProviderModelNotFoundErrorLike(error: unknown): error is ProviderModelNotFoundError {
  if (typeof error !== "object" || error === null) return false
  const o = error as Record<string, unknown>
  return o.name === "ProviderModelNotFoundError" && typeof o.data === "object" && o.data !== null
}

export function parseReadableConfigInvalidError(errorInput: ConfigInvalidError, translator?: Translator) {
  const file = errorInput.data.path && errorInput.data.path !== "config" ? errorInput.data.path : "config"
  const detail = errorInput.data.message?.trim() ?? ""
  const issues = (errorInput.data.issues ?? [])
    .map((issue) => {
      const msg = issue.message.trim()
      if (!issue.path.length) return msg
      return `${issue.path.join(".")}: ${msg}`
    })
    .filter(Boolean)
  const msg = issues.length ? issues.join("\n") : detail
  if (!msg) return tr(translator, "error.chain.configInvalid", `Config file at ${file} is invalid`, { path: file })
  return tr(translator, "error.chain.configInvalidWithMessage", `Config file at ${file} is invalid: ${msg}`, {
    path: file,
    message: msg,
  })
}

function parseReadableProviderModelNotFoundError(errorInput: ProviderModelNotFoundError, translator?: Translator) {
  const p = errorInput.data.providerID.trim()
  const m = errorInput.data.modelID.trim()
  const list = (errorInput.data.suggestions ?? []).map((v) => v.trim()).filter(Boolean)
  const body = tr(translator, "error.chain.modelNotFound", `Model not found: ${p}/${m}`, { provider: p, model: m })
  const tail = tr(translator, "error.chain.checkConfig", "Check your config (opencode.json) provider/model names")
  if (list.length) {
    const suggestions = list.slice(0, 5).join(", ")
    return [body, tr(translator, "error.chain.didYouMean", `Did you mean: ${suggestions}`, { suggestions }), tail].join(
      "\n",
    )
  }
  return [body, tail].join("\n")
}
