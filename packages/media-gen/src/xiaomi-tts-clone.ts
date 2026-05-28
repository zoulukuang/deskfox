// [fork-only] media-gen — 小米 MiMo VoiceClone(mimo-v2.5-tts-voiceclone,参考音频克隆)
// [feat: media-gen-xiaomi] 2026-05-28
//
// 协议:POST /v1/chat/completions,audio.voice 必须是 DataURL(probe 实测确认报错原文:
// "audio.voice must be a DataURL for voice clone model")。
//
// 输入:本地音频路径或 URL → 读字节 + 推 mime → 构 DataURL → 喂 audio.voice
// 上限:base64 后 ≤10MB(官方);adapter 预检 7MB(safety margin,避免编码膨胀踩边界)。
// 支持格式:mp3 / wav(官方明文)。

import { existsSync, readFileSync, statSync } from "node:fs"
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, extname } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { extractAudio, postChatCompletion } from "./xiaomi-chat"
import { XiaomiError } from "./xiaomi-error"

export const VOICECLONE_MODEL = "mimo-v2.5-tts-voiceclone"

/** Safety margin:文件 7MB 预检阻断;base64 编码后约 9.3MB,留缓冲到官方 10MB 上限 */
const REF_MAX_BYTES = 7 * 1024 * 1024

export type VoiceCloneInput = {
  apiKey: string
  text: string
  /** 参考音频路径(本地文件路径,或 file:// URL,或 http(s):// URL) */
  refAudio: string
  /** "wav" | "mp3" | "pcm16",默认 wav */
  format?: "wav" | "mp3" | "pcm16"
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  baseUrl?: string
}

export type VoiceCloneResult = { url: string; model: string; tmpPath: string }

// 小米官方明文支持的参考音频格式 — 其他统统拦在客户端,不让小米后端炸
// 起源:2026-05-28 user 拖 .m4a(苹果录制)进 VoiceClone,我代码默认 audio/wav mime 但字节是 m4a,
//      小米后端报 HTTP 500 "An exception occurred while loading multimodal data: Error while loading data"
//      ⇒ 走 ext 白名单预检,直接友好报错告诉用户用啥格式
const SUPPORTED_EXTS = new Set([".wav", ".mp3", ".mpeg"])

function mimeFromExt(ref: string): "audio/wav" | "audio/mpeg" {
  const ext = extname(ref).toLowerCase()
  if (ext === ".mp3" || ext === ".mpeg") return "audio/mpeg"
  return "audio/wav"
}

function validateExt(ref: string): void {
  const ext = extname(ref).toLowerCase()
  if (!SUPPORTED_EXTS.has(ext)) {
    const display = ext || "(无扩展名)"
    throw new XiaomiError(
      "ref_unsupported_format",
      `语音克隆只支持 wav / mp3 格式参考音频,你的文件是 ${display}。请用音频转换工具(如 ffmpeg、剪映、quicktime)转成 wav 或 mp3 再试。`,
    )
  }
}

async function loadRefAudio(ref: string, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; mime: "audio/wav" | "audio/mpeg" }> {
  // 先验扩展名(防 m4a / aac / flac / opus 等小米后端炸的格式)
  if (ref.startsWith("file://")) {
    const path = fileURLToPath(ref)
    validateExt(path)
    if (!existsSync(path)) throw new XiaomiError("ref_not_found", `参考音频不存在:${path}`)
    return { bytes: readFileSync(path), mime: mimeFromExt(path) }
  }
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    validateExt(ref)
    const res = await fetchImpl(ref)
    if (!res.ok) throw new XiaomiError("ref_fetch_failed", `下载参考音频失败:HTTP ${res.status}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    return { bytes: buf, mime: mimeFromExt(ref) }
  }
  // 当作本地路径
  validateExt(ref)
  if (!existsSync(ref)) throw new XiaomiError("ref_not_found", `参考音频不存在:${ref}`)
  return { bytes: readFileSync(ref), mime: mimeFromExt(ref) }
}

export async function cloneVoice(input: VoiceCloneInput): Promise<VoiceCloneResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const format = input.format ?? "wav"

  // 1) 加载参考音频(本地 / file:// / http(s)://)
  const { bytes, mime } = await loadRefAudio(input.refAudio, fetchImpl)

  // 2) 预检文件大小(safety margin,避免 base64 膨胀后撞 10MB 上限)
  if (bytes.length > REF_MAX_BYTES) {
    const mb = (bytes.length / 1024 / 1024).toFixed(1)
    throw new XiaomiError(
      "ref_too_large",
      `参考音频过大(${mb}MB),小米 VoiceClone 限制 base64 后 ≤10MB,建议原文件 < 7MB。`,
    )
  }

  // 3) 构 DataURL
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`

  // 4) 发请求
  const { json } = await postChatCompletion({
    apiKey: input.apiKey,
    model: VOICECLONE_MODEL,
    messages: [
      { role: "user", content: "" },
      { role: "assistant", content: input.text },
    ],
    audio: { format, voice: dataUrl },
    signal: input.signal,
    fetchImpl,
    baseUrl: input.baseUrl,
  })

  // 5) 解析 + 落盘
  const audio = extractAudio(json)
  const ext = audio.format === "mp3" ? "mp3" : audio.format === "pcm16" ? "pcm" : "wav"
  const tmpPath = join(tmpdir(), `xiaomi-clone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
  writeFileSync(tmpPath, Buffer.from(audio.data, "base64"))
  return { url: pathToFileURL(tmpPath).href, model: VOICECLONE_MODEL, tmpPath }
}
