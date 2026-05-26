// [fork-only] media-gen — 阿里语音合成(qwen-tts,同步多模态生成,无需 WebSocket)
// [feat: media-gen-alibaba] 2026-05-26

import { DASHSCOPE_BASE, DashScopeError, httpError, readJson } from "./dashscope-task"

export const DEFAULT_TTS_MODEL = "qwen-tts"
export const DEFAULT_VOICE = "Cherry"
const ENDPOINT = "/api/v1/services/aigc/multimodal-generation/generation"

export type TtsInput = {
  apiKey: string
  text: string
  voice?: string
  model?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export type TtsResult = { url: string; model: string; voice: string }

export async function synthesizeSpeech(input: TtsInput): Promise<TtsResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const model = input.model ?? DEFAULT_TTS_MODEL
  const voice = input.voice ?? DEFAULT_VOICE

  const res = await fetchImpl(`${DASHSCOPE_BASE}${ENDPOINT}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: { text: input.text, voice } }),
    signal: input.signal,
  })
  const json = await readJson(res)
  if (!res.ok) throw httpError(res.status, json)
  const url: string | undefined = json?.output?.audio?.url
  if (!url) throw new DashScopeError("no_audio", "没拿到语音链接,接口可能有变。", json)
  return { url, model, voice }
}
