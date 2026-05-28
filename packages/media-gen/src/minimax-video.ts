// [fork-only] media-gen — MiniMax 海螺视频(MiniMax-Hailuo-02,异步三步:submit → poll → retrieve)
// [feat: media-gen-minimax] 2026-05-28
//
// 协议:
//   1) POST /v1/video_generation                       → task_id
//   2) GET  /v1/query/video_generation?task_id=<id>    → status: Preparing/Queueing/Processing/Success/Fail
//      + file_id(Success 时)
//   3) GET  /v1/files/retrieve?file_id=<id>            → file.download_url(CDN 链接)
// 注:海螺视频实际生成 1-3 分钟,server 端 idleTimeout 已置 0 不掐 SSE,本引擎 6 分钟 deadline 兜底。

import { MINIMAX_BASE, MinimaxError, type MediaTaskProgress, checkBaseResp, delay, httpError, readJson } from "./minimax-error"

export const DEFAULT_VIDEO_MODEL = "MiniMax-Hailuo-02"

export type VideoInput = {
  apiKey: string
  prompt: string
  model?: string
  /** 首帧图(图生视频,本字段在;纯文生视频可不传)— 本地路径转 base64,http(s) 直传 */
  refImage?: string
  /** 时长秒,Hailuo-02 支持 6/10 */
  duration?: number
  /** 分辨率档:512P / 768P / 1080P(取决于 model 档位) */
  resolution?: string
  signal?: AbortSignal
  onProgress?: (p: MediaTaskProgress) => void
  // ---- 仅测试注入 ----
  fetchImpl?: typeof fetch
  pollIntervalMs?: number
  maxWaitMs?: number
}

export type VideoResult = { url: string; model: string; taskId: string; fileId: string }

const TERMINAL_SUCCESS = new Set(["Success", "success", "SUCCEEDED"])
const TERMINAL_FAIL = new Set(["Fail", "fail", "FAILED"])

function statusToProgress(st: string): MediaTaskProgress {
  if (TERMINAL_SUCCESS.has(st)) return { state: "succeeded", message: "完成" }
  if (TERMINAL_FAIL.has(st)) return { state: "failed", message: "失败" }
  if (st === "Preparing" || st === "Queueing") return { state: "pending", message: "排队中…" }
  return { state: "running", message: "正在生成…" }
}

export async function generateVideo(input: VideoInput): Promise<VideoResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const pollIntervalMs = input.pollIntervalMs ?? 8000
  const maxWaitMs = input.maxWaitMs ?? 360_000
  const model = input.model ?? DEFAULT_VIDEO_MODEL
  const headers = { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" }

  // ----- 1) submit -----
  const submitBody: Record<string, unknown> = { model, prompt: input.prompt }
  if (input.duration) submitBody.duration = input.duration
  if (input.resolution) submitBody.resolution = input.resolution
  if (input.refImage) submitBody.first_frame_image = input.refImage // MiniMax 字段名

  const sr = await fetchImpl(`${MINIMAX_BASE}/v1/video_generation`, {
    method: "POST",
    headers,
    body: JSON.stringify(submitBody),
    signal: input.signal,
  })
  const sj = await readJson(sr)
  if (!sr.ok) throw httpError(sr.status, sj)
  checkBaseResp(sj)
  const taskId: string | undefined = sj?.task_id
  if (!taskId) throw new MinimaxError("no_task_id", "MiniMax 未返回任务 ID,接口可能有变。", sj)
  input.onProgress?.({ state: "pending", message: "已提交,排队中…" })

  // ----- 2) poll -----
  let fileId = ""
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await delay(pollIntervalMs, input.signal)
    const qr = await fetchImpl(`${MINIMAX_BASE}/v1/query/video_generation?task_id=${taskId}`, {
      headers,
      signal: input.signal,
    })
    const qj = await readJson(qr)
    if (!qr.ok) throw httpError(qr.status, qj)
    checkBaseResp(qj)

    const st = String(qj?.status ?? "")
    const prog = statusToProgress(st)
    input.onProgress?.(prog)

    if (prog.state === "succeeded") {
      fileId = String(qj?.file_id ?? "")
      if (!fileId) throw new MinimaxError("no_file_id", "MiniMax 任务成功但无 file_id,接口可能有变。", qj)
      break
    }
    if (prog.state === "failed") {
      const msg = String(qj?.status_msg ?? qj?.base_resp?.status_msg ?? "未知失败")
      throw new MinimaxError("video_fail", `MiniMax 视频生成失败: ${msg}`, qj)
    }
  }
  if (!fileId) throw new MinimaxError("task_timeout", "视频生成超时(超过等待上限未完成),请重试。")

  // ----- 3) retrieve -----
  const fr = await fetchImpl(`${MINIMAX_BASE}/v1/files/retrieve?file_id=${fileId}`, {
    headers,
    signal: input.signal,
  })
  const fj = await readJson(fr)
  if (!fr.ok) throw httpError(fr.status, fj)
  checkBaseResp(fj)
  const url: string | undefined = fj?.file?.download_url
  if (!url) throw new MinimaxError("no_download_url", "MiniMax 文件 retrieve 无下载链接,接口可能有变。", fj)

  return { url, model, taskId, fileId }
}
