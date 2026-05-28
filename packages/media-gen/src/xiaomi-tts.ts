// [fork-only] media-gen — 小米 MiMo 标准 TTS(mimo-v2.5-tts,预设音色)
// [feat: media-gen-xiaomi] 2026-05-28
//
// 协议:POST /v1/chat/completions,messages=[user:风格指令, assistant:待合成文本],audio={format,voice}。
// 响应 choices[0].message.audio.data 是 base64,解出来落 os.tmpdir/<rand>.wav,返回 file:// URL
// (跟 minimax-tts 同一套路,asset-save 已加 file:// 分支)。
//
// 限时免费:Token Plan 当前不消耗额度。

import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { extractAudio, postChatCompletion } from "./xiaomi-chat"

export const DEFAULT_TTS_MODEL = "mimo-v2.5-tts"
// 默认中文女声;voices 全集见 catalog.ts(冰糖/茉莉/苏打/白桦/Chloe/Mia/Milo/Dean/MimoDefault)
export const DEFAULT_VOICE = "茉莉"

export type TtsInput = {
  apiKey: string
  text: string
  /** 预设音色 ID(冰糖/茉莉/苏打/白桦/Chloe/Mia/Milo/Dean/MimoDefault) */
  voice?: string
  model?: string
  /** "wav" | "mp3" | "pcm16",默认 wav(MiMo 默认输出 24kHz PCM16LE mono → wav 容器最自然) */
  format?: "wav" | "mp3" | "pcm16"
  /** 可选风格指令(填进 user message,影响语调)。空则用通用占位。 */
  styleHint?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  baseUrl?: string
}

export type TtsResult = { url: string; model: string; voice: string; tmpPath: string }

export async function synthesizeSpeech(input: TtsInput): Promise<TtsResult> {
  const model = input.model ?? DEFAULT_TTS_MODEL
  const voice = input.voice ?? DEFAULT_VOICE
  const format = input.format ?? "wav"
  const styleHint = input.styleHint ?? "自然清晰的播报语气,语速适中。"

  const { json } = await postChatCompletion({
    apiKey: input.apiKey,
    model,
    messages: [
      { role: "user", content: styleHint },
      { role: "assistant", content: input.text },
    ],
    audio: { format, voice },
    signal: input.signal,
    fetchImpl: input.fetchImpl,
    baseUrl: input.baseUrl,
  })

  const audio = extractAudio(json)
  const ext = audio.format === "mp3" ? "mp3" : audio.format === "pcm16" ? "pcm" : "wav"
  const tmpPath = join(tmpdir(), `xiaomi-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
  writeFileSync(tmpPath, Buffer.from(audio.data, "base64"))
  return { url: pathToFileURL(tmpPath).href, model, voice, tmpPath }
}
