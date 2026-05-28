// [fork-only] media-gen — 小米 MiMo VoiceDesign(mimo-v2.5-tts-voicedesign,文字描述声线)
// [feat: media-gen-xiaomi] 2026-05-28
//
// 协议:POST /v1/chat/completions
// 关键约束:audio object **不能**含 voice 字段(probe 实测报错原文:
// "audio.voice is not supported for voice design model")。
// 声线完全由 user message 的自然语言描述决定,assistant message 填待合成文本。
//
// 风险记录:同一描述多次调用可能生成不同声线(stateless),如要稳定声线需要先 VoiceClone。

import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { extractAudio, postChatCompletion } from "./xiaomi-chat"

export const VOICEDESIGN_MODEL = "mimo-v2.5-tts-voicedesign"

export type VoiceDesignInput = {
  apiKey: string
  text: string
  /** 声线描述,例:"中年男性,声音沉稳有磁性,像新闻主播播报感" */
  voiceDescription: string
  format?: "wav" | "mp3" | "pcm16"
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  baseUrl?: string
}

export type VoiceDesignResult = { url: string; model: string; tmpPath: string }

export async function designVoice(input: VoiceDesignInput): Promise<VoiceDesignResult> {
  const format = input.format ?? "wav"

  const { json } = await postChatCompletion({
    apiKey: input.apiKey,
    model: VOICEDESIGN_MODEL,
    messages: [
      { role: "user", content: input.voiceDescription },
      { role: "assistant", content: input.text },
    ],
    // audio object 只填 format,**不能**有 voice 字段(否则 400 Param Incorrect)
    audio: { format },
    signal: input.signal,
    fetchImpl: input.fetchImpl,
    baseUrl: input.baseUrl,
  })

  const audio = extractAudio(json)
  const ext = audio.format === "mp3" ? "mp3" : audio.format === "pcm16" ? "pcm" : "wav"
  const tmpPath = join(tmpdir(), `xiaomi-design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
  writeFileSync(tmpPath, Buffer.from(audio.data, "base64"))
  return { url: pathToFileURL(tmpPath).href, model: VOICEDESIGN_MODEL, tmpPath }
}
