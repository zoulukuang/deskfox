// [fork-only] media-gen — 阿里 DashScope 文生图全流程(第一竖切,故意单文件不抽象)
// [feat: media-gen-alibaba] 2026-05-26
//
// 流程:异步任务 submit → 拿 task_id → 轮询 GET /tasks/{id} 直到 SUCCEEDED → output.results[].url
// 踩坑预埋(详 OPENCODE-PLAN/需求池/多模态生成-通用plugin框架.md §0.3):
//   - 尺寸用星号 "1024*1024",写 x 直接 400
//   - 状态是大写 PENDING/RUNNING/SUCCEEDED/FAILED,内部归一化为小写
//   - 提交头必须带 X-DashScope-Async: enable
//   - OSS 图片链接 24h 公网可访问,WebView 直接渲染(MVP 不下载、不持久化)

const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com"
const SUBMIT_PATH = "/api/v1/services/aigc/text2image/image-synthesis"
const taskPath = (id: string) => `/api/v1/tasks/${id}`

/**
 * 默认生图模型。2026-05-26 实测:文档里写的 `wan2.6-t2i` 报 InvalidParameter(url error),
 * `wanx2.1-t2i-turbo` 在此端点可用(12.6s 出图)。如阿里后续上新模型,改这里即可。
 */
export const DEFAULT_MODEL = "wanx2.1-t2i-turbo"
export const DEFAULT_SIZE = "1024*1024"

export type TaskState = "pending" | "running" | "succeeded" | "failed"

export type ImageGenInput = {
  apiKey: string
  prompt: string
  model?: string
  /** 接受 "1024x1024" / "1280X720" / "1024*1024",内部统一转星号 */
  size?: string
  n?: number
  signal?: AbortSignal
  onProgress?: (p: { state: TaskState; message: string }) => void
  // ---- 以下仅测试注入 ----
  fetchImpl?: typeof fetch
  pollIntervalMs?: number
  maxWaitMs?: number
}

export type ImageGenResult = { urls: string[]; model: string; taskId: string }

/** 归一化后的、带中文用户文案的错误 */
export class DashScopeError extends Error {
  constructor(
    public code: string,
    public friendly: string,
    public raw?: unknown,
  ) {
    super(friendly)
    this.name = "DashScopeError"
  }
}

const ERROR_MAP: Record<string, string> = {
  DataInspectionFailed: "内容被审核驳回,可能含敏感词。请改写描述后重试。",
  "Throttling.RateQuota": "调用频率超限,请稍后重试。",
  "Throttling.AllocationQuota": "当日额度已用完,请明天再试或换 provider。",
  InsufficientQuota: "账户余额不足或额度已用完。",
  InvalidApiKey: "API Key 无效,请检查阿里供应商配置。",
  "InvalidParameter.Model": "模型 ID 无效,请换一个生图模型(如 wanx2.1-t2i-turbo)。",
}

function translate(code: string, message?: string): string {
  return ERROR_MAP[code] ?? `阿里返回错误(${code})${message ? ": " + message : ""}`
}

/** 把对外友好的尺寸写法统一成 DashScope 要的星号格式 */
export function normalizeSize(size: string): string {
  return size.trim().replace(/[xX×]/g, "*")
}

function normalizeState(raw: string): TaskState {
  if (raw === "SUCCEEDED") return "succeeded"
  if (raw === "FAILED" || raw === "CANCELED" || raw === "CANCELLED") return "failed"
  if (raw === "PENDING") return "pending"
  return "running" // RUNNING / UNKNOWN / 其它非终态都按 running,靠 maxWaitMs 兜底
}

function extractUrls(taskJson: any): string[] {
  const results = taskJson?.output?.results
  if (!Array.isArray(results)) return []
  return results.map((r: any) => r?.url).filter((u: any): u is string => typeof u === "string")
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

function httpError(status: number, body: any): DashScopeError {
  if (status === 401 || status === 403)
    return new DashScopeError("auth_failed", "API Key 无效或无权限,请检查阿里供应商配置。", body)
  if (status === 429) return new DashScopeError("rate_limit", "调用频率超限,请稍后重试。", body)
  const code = body?.code ?? `http_${status}`
  return new DashScopeError(String(code), translate(String(code), body?.message), body)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DashScopeError("aborted", "已取消。"))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t)
        reject(new DashScopeError("aborted", "已取消。"))
      },
      { once: true },
    )
  })
}

/**
 * 文生图全流程。成功返回图片 URL 列表;失败抛 DashScopeError(已带中文文案)。
 */
export async function generateImage(input: ImageGenInput): Promise<ImageGenResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const model = input.model ?? DEFAULT_MODEL
  const size = normalizeSize(input.size ?? DEFAULT_SIZE)
  const n = input.n ?? 1
  const pollIntervalMs = input.pollIntervalMs ?? 3000
  const maxWaitMs = input.maxWaitMs ?? 180_000

  // 1. 提交异步任务
  const submitRes = await fetchImpl(`${DASHSCOPE_BASE}${SUBMIT_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "X-DashScope-Async": "enable",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: { prompt: input.prompt }, parameters: { size, n } }),
    signal: input.signal,
  })
  const submitJson = await readJson(submitRes)
  if (!submitRes.ok) throw httpError(submitRes.status, submitJson)
  const taskId: string | undefined = submitJson?.output?.task_id
  if (!taskId) throw new DashScopeError("no_task_id", "阿里未返回任务 ID,接口可能有变。", submitJson)
  input.onProgress?.({ state: "pending", message: "已提交,排队中…" })

  // 2. 轮询直到终态
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await delay(pollIntervalMs, input.signal)
    const taskRes = await fetchImpl(`${DASHSCOPE_BASE}${taskPath(taskId)}`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: input.signal,
    })
    const taskJson = await readJson(taskRes)
    if (!taskRes.ok) throw httpError(taskRes.status, taskJson)

    const state = normalizeState(String(taskJson?.output?.task_status ?? "").toUpperCase())
    if (state === "succeeded") {
      const urls = extractUrls(taskJson)
      if (urls.length === 0) throw new DashScopeError("no_image", "任务成功但没拿到图片链接。", taskJson)
      input.onProgress?.({ state: "succeeded", message: `完成,生成 ${urls.length} 张` })
      return { urls, model, taskId }
    }
    if (state === "failed") {
      const code = String(taskJson?.output?.code ?? "unknown")
      throw new DashScopeError(code, translate(code, taskJson?.output?.message), taskJson)
    }
    input.onProgress?.({ state, message: state === "running" ? "正在生成…" : "排队中…" })
  }
  throw new DashScopeError("task_timeout", "生成超时(超过 3 分钟未完成),请重试或换 provider。")
}
