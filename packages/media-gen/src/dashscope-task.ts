// [fork-only] media-gen — DashScope 通用异步任务引擎 + 共享错误/工具
// [feat: media-gen-alibaba] 2026-05-26
//
// 阿里 6 能力里 4 项(文生图/图生图/文生视频/图生视频/语音识别)都是异步任务:
//   submit(头 X-DashScope-Async: enable)→ 拿 task_id → 轮询 GET /tasks/{id} → 终态
// 本文件提供 runDashScopeTask(覆盖这 4 项)+ 同步调用也复用的 httpError/readJson/translate。
// 踩坑见 OPENCODE-PLAN/需求池/多模态生成-通用plugin框架.md §0.3。

export const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com"

export type TaskState = "pending" | "running" | "succeeded" | "failed"

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
  "InvalidParameter.Model": "模型 ID 无效,请换一个有效模型。",
}

export function translate(code: string, message?: string): string {
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

export async function readJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

export function httpError(status: number, body: any): DashScopeError {
  if (status === 401 || status === 403)
    return new DashScopeError("auth_failed", "API Key 无效或无权限,请检查阿里供应商配置。", body)
  if (status === 429) return new DashScopeError("rate_limit", "调用频率超限,请稍后重试。", body)
  const code = body?.code ?? `http_${status}`
  return new DashScopeError(String(code), translate(String(code), body?.message), body)
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
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

export type TaskProgress = { state: TaskState; message: string }

export type TaskRunInput = {
  apiKey: string
  endpoint: string
  body: unknown
  /** 额外提交头,如使用 oss:// 资源时的 X-DashScope-OssResourceResolve: enable */
  extraHeaders?: Record<string, string>
  signal?: AbortSignal
  onProgress?: (p: TaskProgress) => void
  // ---- 以下仅测试注入 ----
  fetchImpl?: typeof fetch
  pollIntervalMs?: number
  maxWaitMs?: number
}

/**
 * 跑一个 DashScope 异步任务到终态。成功返回 { taskId, output },失败抛 DashScopeError。
 * output 的解析(图片 url / 视频 url / 转写 url)由各能力模块自己做。
 */
export async function runDashScopeTask(input: TaskRunInput): Promise<{ taskId: string; output: any }> {
  const fetchImpl = input.fetchImpl ?? fetch
  const pollIntervalMs = input.pollIntervalMs ?? 3000
  const maxWaitMs = input.maxWaitMs ?? 180_000

  const submitRes = await fetchImpl(`${DASHSCOPE_BASE}${input.endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "X-DashScope-Async": "enable",
      "Content-Type": "application/json",
      ...(input.extraHeaders ?? {}),
    },
    body: JSON.stringify(input.body),
    signal: input.signal,
  })
  const submitJson = await readJson(submitRes)
  if (!submitRes.ok) throw httpError(submitRes.status, submitJson)
  const taskId: string | undefined = submitJson?.output?.task_id
  if (!taskId) throw new DashScopeError("no_task_id", "阿里未返回任务 ID,接口可能有变。", submitJson)
  input.onProgress?.({ state: "pending", message: "已提交,排队中…" })

  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await delay(pollIntervalMs, input.signal)
    const taskRes = await fetchImpl(`${DASHSCOPE_BASE}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${input.apiKey}` },
      signal: input.signal,
    })
    const taskJson = await readJson(taskRes)
    if (!taskRes.ok) throw httpError(taskRes.status, taskJson)

    const state = normalizeState(String(taskJson?.output?.task_status ?? "").toUpperCase())
    if (state === "succeeded") {
      input.onProgress?.({ state: "succeeded", message: "完成" })
      return { taskId, output: taskJson?.output }
    }
    if (state === "failed") {
      const code = String(taskJson?.output?.code ?? "unknown")
      throw new DashScopeError(code, translate(code, taskJson?.output?.message), taskJson)
    }
    input.onProgress?.({ state, message: state === "running" ? "正在生成…" : "排队中…" })
  }
  throw new DashScopeError("task_timeout", "生成超时(超过等待上限未完成),请重试或换 provider。")
}
