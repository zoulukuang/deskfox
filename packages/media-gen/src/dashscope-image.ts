// [fork-only] media-gen — 阿里文生图 / 图生图(改图)
// [feat: media-gen-alibaba] 2026-05-26
// 文生图走 text2image 端点;给了参考图(refImages)则走 image2image 改图端点。
// 两者都是异步任务,复用 dashscope-task 的 runDashScopeTask。

import { DashScopeError, normalizeSize, runDashScopeTask, type TaskProgress } from "./dashscope-task"

export { DashScopeError, normalizeSize } from "./dashscope-task"

export const DEFAULT_MODEL = "wanx2.1-t2i-turbo" // 高清档可传 wanx2.1-t2i-plus
export const DEFAULT_EDIT_MODEL = "wanx2.1-imageedit"
export const DEFAULT_SIZE = "1024*1024"

const T2I_ENDPOINT = "/api/v1/services/aigc/text2image/image-synthesis"
const EDIT_ENDPOINT = "/api/v1/services/aigc/image2image/image-synthesis"

export type ImageGenInput = {
  apiKey: string
  prompt: string
  model?: string
  size?: string // "1024x1024" / "1024*1024" 均可
  n?: number
  refImages?: string[] // 公网 URL;给了就走改图
  signal?: AbortSignal
  onProgress?: (p: TaskProgress) => void
  // ---- 仅测试注入 ----
  fetchImpl?: typeof fetch
  pollIntervalMs?: number
  maxWaitMs?: number
}

export type ImageGenResult = { urls: string[]; model: string; taskId: string }

export async function generateImage(input: ImageGenInput): Promise<ImageGenResult> {
  const isEdit = !!(input.refImages && input.refImages.length > 0)
  const model = input.model ?? (isEdit ? DEFAULT_EDIT_MODEL : DEFAULT_MODEL)
  const n = input.n ?? 1

  const body = isEdit
    ? {
        model,
        input: { function: "description_edit", prompt: input.prompt, base_image_url: input.refImages![0] },
        parameters: { n },
      }
    : {
        model,
        input: { prompt: input.prompt },
        parameters: { size: normalizeSize(input.size ?? DEFAULT_SIZE), n },
      }

  const { taskId, output } = await runDashScopeTask({
    apiKey: input.apiKey,
    endpoint: isEdit ? EDIT_ENDPOINT : T2I_ENDPOINT,
    body,
    signal: input.signal,
    onProgress: input.onProgress,
    fetchImpl: input.fetchImpl,
    pollIntervalMs: input.pollIntervalMs,
    maxWaitMs: input.maxWaitMs,
  })

  const urls: string[] = Array.isArray(output?.results)
    ? output.results.map((r: any) => r?.url).filter((u: any): u is string => typeof u === "string")
    : []
  if (urls.length === 0) throw new DashScopeError("no_image", "任务成功但没拿到图片链接。", output)
  return { urls, model, taskId }
}
