export const GETBOT_PROVIDER_ID = "getbot"
// 短名,所有 provider.name 渲染点都用它（model picker group 头、composer pill 等）。
// "模型聚合平台 按量计费"作为 tagline 单独存在 i18n 里,只在 provider 选择弹窗里挂在名字旁边。
export const GETBOT_PROVIDER_NAME = "GetBot"
export const GETBOT_BASE_URL = "https://api.getbot.me/v1"
export const GETBOT_NPM = "@ai-sdk/openai-compatible"
export const GETBOT_SITE_URL = "https://getbot.me"

export class GetbotInvalidKeyError extends Error {
  constructor(public status: number, public body: string) {
    super(`GetBot API key invalid (HTTP ${status})`)
    this.name = "GetbotInvalidKeyError"
  }
}

export class GetbotTimeoutError extends Error {
  constructor() {
    super("GetBot /v1/models request timed out")
    this.name = "GetbotTimeoutError"
  }
}

const FETCH_TIMEOUT_MS = 15000

const CLASSIFY_RULES: { cat: "image" | "tts" | "asr"; re: RegExp }[] = [
  { cat: "image", re: /image|flux|sd-?xl|sd-?[0-9]|dall-?e|\bmj\b|midjourney|ideogram|stable-diffusion|playground-v/i },
  { cat: "tts", re: /^(?!.*realtime).*((^|[-_/])tts([-_]|$)|(^|[-_/])speech([-_/]|$)|cosyvoice|sambert)/i },
  { cat: "asr", re: /^(?!.*realtime).*(whisper|(^|[-_])asr([-_]|$)|(^|[-_])omni([-_]|$)|livetranslate)/i },
]

export type GetbotModelMeta = {
  name: string
  tool_call?: boolean
  attachment?: boolean
  reasoning?: boolean
  modalities?: string[]
}

// FORK-BEGIN: REQ-054 — mergeGetbotModels 纯函数:remote ids 为主、local 能力标注优先保留、幽灵自然丢弃 2026-06-18
/** 宽松输入类型:接受来自 SDK config 的 { name?: string; ... } 形态,不要求 name 必填 */
export type GetbotModelMetaInput = {
  name?: string
  tool_call?: boolean
  attachment?: boolean
  reasoning?: boolean
  modalities?: string[]
}

/**
 * 将远端 /v1/models 返回的最新 id 列表与本地已有配置合并:
 * - 仅保留 remoteIds 中存在的模型(幽灵自然丢弃);
 * - 已有手工能力标注(tool_call/attachment/reasoning)原样保留;
 * - 新增模型走 inferModelConfig 兜底推断;
 * - 返回按 id 字母序排序的新 Record。
 *
 * 纯函数,无副作用,便于单测。
 */
export function mergeGetbotModels(
  existing: Record<string, GetbotModelMetaInput>,
  remoteIds: string[],
): Record<string, GetbotModelMeta> {
  const next: Record<string, GetbotModelMeta> = {}
  for (const id of remoteIds) {
    const local = existing[id]
    if (local !== undefined) {
      // 保留已有能力标注,name 若缺失则回退到 id;modalities 同样原样保留
      next[id] = { name: local.name ?? id, tool_call: local.tool_call, attachment: local.attachment, reasoning: local.reasoning, modalities: local.modalities }
    } else {
      next[id] = inferModelConfig(id)
    }
  }
  return next
}
// FORK-END

export function inferModelConfig(id: string): GetbotModelMeta {
  const isRealtime = /realtime|streaming/i.test(id)
  const isOmni = /omni/i.test(id)
  const isVision = /vision|vl\b|visual/i.test(id)
  const isAudio = /audio|asr|tts|whisper|speech/i.test(id)
  const isReasoning = /\bo1\b|\bo3\b|\bo4\b|thinking|reasoning/i.test(id)
  const cfg: GetbotModelMeta = { name: id }
  cfg.tool_call = !isRealtime
  if (isOmni || isVision || isAudio || /gpt-4o|claude/i.test(id)) cfg.attachment = true
  if (isReasoning) cfg.reasoning = true
  return cfg
}

function extractModelIds(raw: unknown): string[] {
  const pickId = (m: unknown): string | undefined => {
    if (typeof m === "string") return m
    if (m && typeof m === "object") {
      const obj = m as { id?: unknown; name?: unknown }
      if (typeof obj.id === "string") return obj.id
      if (typeof obj.name === "string") return obj.name
    }
    return undefined
  }
  if (Array.isArray(raw)) return raw.map(pickId).filter((x): x is string => Boolean(x))
  if (raw && typeof raw === "object") {
    const obj = raw as { data?: unknown; models?: unknown }
    if (Array.isArray(obj.data)) return obj.data.map(pickId).filter((x): x is string => Boolean(x))
    if (Array.isArray(obj.models)) return obj.models.map(pickId).filter((x): x is string => Boolean(x))
  }
  throw new Error("无法识别 /v1/models 响应结构")
}

export function filterChatModels(ids: string[]): string[] {
  const chat: string[] = []
  for (const id of ids) {
    let matched = false
    for (const { re } of CLASSIFY_RULES) {
      if (re.test(id)) {
        matched = true
        break
      }
    }
    if (!matched) chat.push(id)
  }
  return chat.sort((a, b) => a.localeCompare(b))
}

export async function fetchGetbotChatModels(
  apiKey: string,
  opts?: { fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number },
): Promise<string[]> {
  const url = `${GETBOT_BASE_URL}/models`
  const fetchFn = opts?.fetch ?? fetch
  const timeoutMs = opts?.timeoutMs ?? FETCH_TIMEOUT_MS

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const externalAbort = opts?.signal
  if (externalAbort) externalAbort.addEventListener("abort", () => ac.abort())

  let resp: Response
  try {
    resp = await fetchFn(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ac.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    if (ac.signal.aborted && !externalAbort?.aborted) throw new GetbotTimeoutError()
    throw e
  }
  clearTimeout(timer)

  if (!resp.ok) {
    const body = await resp.text().catch(() => "")
    if (resp.status === 401 || resp.status === 403) {
      throw new GetbotInvalidKeyError(resp.status, body.slice(0, 200))
    }
    throw new Error(`GET ${url} HTTP ${resp.status}: ${body.slice(0, 200)}`)
  }
  const raw = await resp.json()
  return filterChatModels(extractModelIds(raw))
}

export function buildGetbotProviderConfig(apiKey: string, chatIds: string[]) {
  const models: Record<string, GetbotModelMeta> = {}
  for (const id of chatIds) models[id] = inferModelConfig(id)
  return {
    name: GETBOT_PROVIDER_NAME,
    npm: GETBOT_NPM,
    options: {
      baseURL: GETBOT_BASE_URL,
      apiKey,
    },
    models,
  }
}
