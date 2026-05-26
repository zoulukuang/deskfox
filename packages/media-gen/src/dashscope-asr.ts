// [fork-only] media-gen — 阿里语音识别(paraformer,异步任务 + 转写 JSON 二次拉取)
// [feat: media-gen-alibaba] 2026-05-26
// 提交音频 URL → 轮询 → 拿到 transcription_url(指向转写 JSON)→ 再 fetch 取文字。

import { DashScopeError, readJson, runDashScopeTask, type TaskProgress } from "./dashscope-task"

export const DEFAULT_ASR_MODEL = "paraformer-v2"
const ENDPOINT = "/api/v1/services/audio/asr/transcription"

export type AsrInput = {
  apiKey: string
  audioUrl: string // 公网可访问的音频 URL
  model?: string
  signal?: AbortSignal
  onProgress?: (p: TaskProgress) => void
  fetchImpl?: typeof fetch
  pollIntervalMs?: number
  maxWaitMs?: number
}

export type AsrResult = { text: string; model: string; taskId: string }

export async function transcribeAudio(input: AsrInput): Promise<AsrResult> {
  const model = input.model ?? DEFAULT_ASR_MODEL
  const fetchImpl = input.fetchImpl ?? fetch

  const { taskId, output } = await runDashScopeTask({
    apiKey: input.apiKey,
    endpoint: ENDPOINT,
    body: { model, input: { file_urls: [input.audioUrl] }, parameters: {} },
    signal: input.signal,
    onProgress: input.onProgress,
    fetchImpl: input.fetchImpl,
    pollIntervalMs: input.pollIntervalMs,
    maxWaitMs: input.maxWaitMs,
  })

  const transcriptionUrl: string | undefined = output?.results?.[0]?.transcription_url
  if (!transcriptionUrl) throw new DashScopeError("no_transcription", "没拿到转写结果链接。", output)

  const transcriptJson = await readJson(await fetchImpl(transcriptionUrl))
  const text: string =
    transcriptJson?.transcripts?.[0]?.text ??
    (Array.isArray(transcriptJson?.transcripts)
      ? transcriptJson.transcripts.map((t: any) => t?.text).join("\n")
      : "")
  if (!text) throw new DashScopeError("empty_transcription", "转写结果为空。", transcriptJson)
  return { text, model, taskId }
}
