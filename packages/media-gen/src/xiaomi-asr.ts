// [fork-only] media-gen — 小米 MiMo Omni 当 ASR 用(mimo-v2.5,多模态音频 → 文字)
// [feat: media-gen-xiaomi] 2026-05-28
//
// 协议:POST /v1/chat/completions,user content 数组里塞 { type: "input_audio", input_audio: { data, format } }。
// probe 实测短音频 7.8s 转写,跟原文几乎逐字命中(但慢于阿里 paraformer-v2 1-3s,作为备选档不打 isDefault)。
//
// model 选择:mimo-v2.5-asr 在 Token Plan 没暴露(probe 实测 "Not supported model"),只能走 mimo-v2.5 Omni。

import { existsSync, readFileSync } from "node:fs"
import { extname } from "node:path"
import { fileURLToPath } from "node:url"
import { postChatCompletion, extractText } from "./xiaomi-chat"
import { XiaomiError } from "./xiaomi-error"

export const ASR_MODEL = "mimo-v2.5"

/** Omni 多模态消息里 input_audio 也走 base64,跟 VoiceClone 同一 10MB 上限思路,预检 7MB */
const AUDIO_MAX_BYTES = 7 * 1024 * 1024

export type AsrInput = {
  apiKey: string
  /** 音频路径(本地 / file:// / http(s)://) */
  audioUrl: string
  /** 转写指令,默认让模型只输出原文 */
  instruction?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  baseUrl?: string
}

export type AsrResult = { text: string; model: string }

function formatFromExt(ref: string): "wav" | "mp3" {
  const ext = extname(ref).toLowerCase()
  return ext === ".mp3" || ext === ".mpeg" ? "mp3" : "wav"
}

async function loadAudio(ref: string, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; format: "wav" | "mp3" }> {
  if (ref.startsWith("file://")) {
    const path = fileURLToPath(ref)
    if (!existsSync(path)) throw new XiaomiError("audio_not_found", `音频文件不存在:${path}`)
    return { bytes: readFileSync(path), format: formatFromExt(path) }
  }
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    const res = await fetchImpl(ref)
    if (!res.ok) throw new XiaomiError("audio_fetch_failed", `下载音频失败:HTTP ${res.status}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    return { bytes: buf, format: formatFromExt(ref) }
  }
  if (!existsSync(ref)) throw new XiaomiError("audio_not_found", `音频文件不存在:${ref}`)
  return { bytes: readFileSync(ref), format: formatFromExt(ref) }
}

export async function transcribeAudio(input: AsrInput): Promise<AsrResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const { bytes, format } = await loadAudio(input.audioUrl, fetchImpl)

  if (bytes.length > AUDIO_MAX_BYTES) {
    const mb = (bytes.length / 1024 / 1024).toFixed(1)
    throw new XiaomiError(
      "audio_too_large",
      `音频文件过大(${mb}MB),小米 Omni ASR 建议 < 7MB(更长音频请用阿里 paraformer-v2)。`,
    )
  }

  const data = Buffer.from(bytes).toString("base64")
  const instruction = input.instruction ?? "请把这段音频内容逐字转成文字,只输出文字本身,不要任何额外解释。"

  const { json } = await postChatCompletion({
    apiKey: input.apiKey,
    model: ASR_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: instruction },
          { type: "input_audio", input_audio: { data, format } },
        ],
      },
    ],
    signal: input.signal,
    fetchImpl,
    baseUrl: input.baseUrl,
  })

  const text = extractText(json)
  return { text, model: ASR_MODEL }
}
