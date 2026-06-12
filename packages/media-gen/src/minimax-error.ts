// [fork-only] media-gen — MiniMax 共享错误处理 + 类型
// [feat: media-gen-minimax] 2026-05-28
//
// MiniMax API 用 base_resp.status_code 表示业务错误(0=ok / 1004=auth / 1008=balance / ...),
// 不同于 dashscope 的 HTTP+code 字段。3 个 minimax 引擎(image/video/tts)共用此模块解析+友好提示。

export const MINIMAX_BASE = process.env.MINIMAX_BASE || "https://api.minimaxi.com"

/** 跑长任务时的进度回调(给 server SSE 用) */
export type MediaTaskState = "pending" | "running" | "succeeded" | "failed"
export type MediaTaskProgress = { state: MediaTaskState; message: string }

/** 归一化后的、带中文用户文案的错误 */
export class MinimaxError extends Error {
  constructor(
    public code: string,
    public friendly: string,
    public raw?: unknown,
  ) {
    super(friendly)
    this.name = "MinimaxError"
  }
}

/** 已知 base_resp.status_code → 友好文案 */
const ERROR_MAP: Record<string, string> = {
  "1004": "MiniMax API Key 鉴权失败,确认 auth.json 里 `minimax-cn` 的 key 还有效。",
  "1008": "MiniMax 账户余额不足或订阅套餐失效,请充值或续订。",
  "1013": "调用频率超限,请稍后重试。",
  "1026": "内容审核未通过(可能含敏感词),请改写描述后重试。",
  "1027": "输出审核未通过(MiniMax 风控触发),请改写描述后重试。",
  "1039": "生成任务被取消或超时。",
  "1041": "音频文件格式或大小不符合要求。",
  "1042": "提示词过长,请精简后重试。",
}

/**
 * 2056 = MiniMax usage limit / quota 错误,两种场景需区分:
 * - "(0/0 used)" = 套餐对该能力**无配额**(如 Token Plan Plus 仅含 image,TTS/video 0 配额)
 * - "(N/M used)" 且 N>0 = 真的把 5h 窗口配额耗尽,等 resets 时间再试
 * 解析 status_msg 文本来给精准提示(2026-05-28 user 真实踩坑后引入)。
 */
function translate2056(msg?: string): string {
  if (msg && /\(\s*0\s*\/\s*0\s+used\s*\)/i.test(msg)) {
    const resets = /resets at ([^)]+)/i.exec(msg)?.[1]?.trim()
    return `MiniMax 当前套餐对该能力无配额(0/0,即该套餐不含此能力)。需升级套餐或换 provider${resets ? ` (服务器报重置时间 ${resets},但 0/0 配额等重置也不会有)` : ""}。`
  }
  return `MiniMax 套餐 5 小时窗口配额耗尽,稍后或下个重置时间再试${msg ? ` (${msg})` : ""}。`
}

export function translateBaseResp(code: number | string, msg?: string): string {
  const key = String(code)
  if (key === "2056") return translate2056(msg)
  return ERROR_MAP[key] ?? `MiniMax 返回错误(${key})${msg ? ": " + msg : ""}`
}

export async function readJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

/** HTTP 层失败:401/403 → auth / 429 → rate / 其他给原始 status */
export function httpError(status: number, body: any): MinimaxError {
  if (status === 401 || status === 403)
    return new MinimaxError("auth_failed", "MiniMax API Key 无效或无权限,请检查 minimax-cn 配置。", body)
  if (status === 429) return new MinimaxError("rate_limit", "调用频率超限,请稍后重试。", body)
  return new MinimaxError(`http_${status}`, `MiniMax HTTP ${status}: ${JSON.stringify(body).slice(0, 200)}`, body)
}

/**
 * 检查 base_resp.status_code。0 = OK(返回 void),否则抛 MinimaxError。
 * 业务错误从 base_resp 拿,不依赖 HTTP status(MiniMax 业务错误也常返 200)。
 */
export function checkBaseResp(json: any): void {
  const code = json?.base_resp?.status_code
  if (code === 0 || code === undefined) return
  const msg = json?.base_resp?.status_msg
  throw new MinimaxError(String(code), translateBaseResp(code, msg), json)
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new MinimaxError("aborted", "已取消。"))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        reject(new MinimaxError("aborted", "已取消。"))
      },
      { once: true },
    )
  })
}
