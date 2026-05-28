// [fork-only] media-gen — MiniMax 语音合成(t2a_v2,同步 POST → hex 内联 audio)
// [feat: media-gen-minimax] 2026-05-28
//
// 端点:POST /v1/t2a_v2
// 协议:body 含 model/text/voice_setting/audio_setting/stream;响应 data.audio 是 hex 字符串。
// 关键差异:与 dashscope-tts(返回 URL)不同,本引擎把 hex 解出来落 os.tmpdir/<rand>.mp3,
// 然后返回 `file://...mp3` URL,跟其他引擎的 URL 契约一致;asset-save 已加 file:// 分支处理。

import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { MINIMAX_BASE, MinimaxError, checkBaseResp, httpError, readJson } from "./minimax-error"

// 2026-05-28 实测 + FAQ 确认:Token Plan 走 -hd 后缀(speech-2.8-hd / 2.6-hd / 02-hd),
// -turbo 走积分计费(没积分就 0/0)。坑点:客服只说 "speech-2.8",实际要带 -hd 才走 Token Plan 配额。
export const DEFAULT_TTS_MODEL = "speech-2.8-hd"
export const DEFAULT_VOICE = "male-qn-qingse"

export type TtsInput = {
  apiKey: string
  text: string
  /** MiniMax voice_id(如 "male-qn-qingse" / "female-shaonv" / 用户克隆) */
  voice?: string
  model?: string
  /** "mp3" | "wav" | "pcm" | "flac",默认 mp3 */
  format?: "mp3" | "wav" | "pcm" | "flac"
  speed?: number // 0.5 ~ 2.0
  vol?: number // 0 ~ 10
  pitch?: number // -12 ~ 12
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export type TtsResult = { url: string; model: string; voice: string; tmpPath: string }

export async function synthesizeSpeech(input: TtsInput): Promise<TtsResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const model = input.model ?? DEFAULT_TTS_MODEL
  const voice = input.voice ?? DEFAULT_VOICE
  const format = input.format ?? "mp3"

  const res = await fetchImpl(`${MINIMAX_BASE}/v1/t2a_v2`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      text: input.text,
      stream: false,
      voice_setting: { voice_id: voice, speed: input.speed ?? 1.0, vol: input.vol ?? 1.0, pitch: input.pitch ?? 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format },
    }),
    signal: input.signal,
  })
  const json = await readJson(res)
  if (!res.ok) throw httpError(res.status, json)
  checkBaseResp(json)

  const audioHex: string | undefined = json?.data?.audio
  if (!audioHex || typeof audioHex !== "string") {
    throw new MinimaxError("no_audio", "MiniMax 没返回音频数据,接口可能有变。", json)
  }

  // hex 解 bytes,写 os.tmpdir;saveAssets 之后把它移到 creations/audio/
  const bytes = Buffer.from(audioHex, "hex")
  if (bytes.length === 0) {
    throw new MinimaxError("empty_audio", "MiniMax 返回的音频数据为空。", json)
  }
  const tmpPath = join(tmpdir(), `minimax-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${format}`)
  writeFileSync(tmpPath, bytes)

  return { url: pathToFileURL(tmpPath).href, model, voice, tmpPath }
}
