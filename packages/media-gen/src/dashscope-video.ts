// [fork-only] media-gen — 阿里文生视频 / 图生视频
// [feat: media-gen-alibaba] 2026-05-26
// 给了 refImage(公网 URL)走图生视频(i2v),否则文生视频(t2v)。异步任务,轮询更久。

import { DashScopeError, normalizeSize, runDashScopeTask, type TaskProgress } from "./dashscope-task"

export const DEFAULT_T2V_MODEL = "wanx2.1-t2v-turbo"
export const DEFAULT_I2V_MODEL = "wanx2.1-i2v-turbo"
const ENDPOINT = "/api/v1/services/aigc/video-generation/video-synthesis"

export type VideoGenInput = {
  apiKey: string
  prompt: string
  model?: string
  refImage?: string // 公网 URL;给了就走 i2v
  size?: string // t2v 用,默认 1280*720
  signal?: AbortSignal
  onProgress?: (p: TaskProgress) => void
  fetchImpl?: typeof fetch
  pollIntervalMs?: number
  maxWaitMs?: number
}

export type VideoGenResult = { url: string; model: string; taskId: string }

export async function generateVideo(input: VideoGenInput): Promise<VideoGenResult> {
  const isI2V = !!input.refImage
  const model = input.model ?? (isI2V ? DEFAULT_I2V_MODEL : DEFAULT_T2V_MODEL)

  const body = isI2V
    ? { model, input: { prompt: input.prompt, img_url: input.refImage }, parameters: { resolution: "720P" } }
    : { model, input: { prompt: input.prompt }, parameters: { size: normalizeSize(input.size ?? "1280*720") } }

  const { taskId, output } = await runDashScopeTask({
    apiKey: input.apiKey,
    endpoint: ENDPOINT,
    body,
    signal: input.signal,
    onProgress: input.onProgress,
    fetchImpl: input.fetchImpl,
    pollIntervalMs: input.pollIntervalMs ?? 6000, // 视频慢,轮询间隔放宽
    maxWaitMs: input.maxWaitMs ?? 360_000, // 最长等 6 分钟
  })

  const url: string | undefined = output?.video_url
  if (!url) throw new DashScopeError("no_video", "任务成功但没拿到视频链接。", output)
  return { url, model, taskId }
}
