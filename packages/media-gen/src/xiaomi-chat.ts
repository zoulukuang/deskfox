// [fork-only] media-gen — 小米 MiMo 统一 chat-completions POST helper
// [feat: media-gen-xiaomi] 2026-05-28
//
// 小米所有媒体能力(TTS / VoiceClone / VoiceDesign / Omni-ASR)共用 /v1/chat/completions endpoint。
// 不同 adapter 只是 messages / audio 字段构造不一样,POST 本身这一层抽出来共用。
//
// Auth 头注意:小米是 "api-key: <key>"(不是 "Authorization: Bearer <key>")—— probe 实测确认。
// 错误处理统一走 xiaomi-error 模块,业务 / HTTP / network 三层都覆盖。

import { XIAOMI_BASE, XiaomiError, checkErrorResp, httpError, readJson } from "./xiaomi-error"

export type XiaomiMessage =
  | { role: "user" | "assistant" | "system"; content: string }
  | {
      role: "user"
      content: Array<
        | { type: "text"; text: string }
        | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" } }
      >
    }

export type XiaomiAudioConfig = {
  format: "wav" | "pcm16" | "mp3"
  /** 预设音色 ID(标准 TTS) 或 DataURL(VoiceClone)。VoiceDesign 不填。 */
  voice?: string
}

export type XiaomiChatRequest = {
  apiKey: string
  model: string
  messages: XiaomiMessage[]
  audio?: XiaomiAudioConfig
  signal?: AbortSignal
  /** 仅测试注入 */
  fetchImpl?: typeof fetch
  /** 仅测试注入,覆盖 base URL */
  baseUrl?: string
}

export type XiaomiChatResponse = {
  /** raw OpenAI-shape json,adapter 内自己挑字段 */
  json: any
}

/**
 * 统一 POST /chat/completions。
 * - 200 → 检查 body.error(业务错误也可能 200);无 error 返 json
 * - 非 200 → 走 httpError(401/403/429/其他)
 * - network throw → 包成 XiaomiError("network", ...)
 */
export async function postChatCompletion(req: XiaomiChatRequest): Promise<XiaomiChatResponse> {
  const fetchImpl = req.fetchImpl ?? fetch
  const base = req.baseUrl ?? XIAOMI_BASE
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
  }
  if (req.audio) body.audio = req.audio

  let res: Response
  try {
    res = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: { "api-key": req.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal,
    })
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e)
    throw new XiaomiError("network", `网络错误,无法连接小米 MiMo:${cause}`, e)
  }

  const json = await readJson(res)
  if (!res.ok) throw httpError(res.status, json)
  checkErrorResp(json)
  return { json }
}

/**
 * 从 chat completion 响应里抽 audio.data(base64)+ format。
 * 三档 TTS adapter 共用此 helper。
 */
export function extractAudio(json: any): { data: string; format: "wav" | "pcm16" | "mp3" } {
  const audio = json?.choices?.[0]?.message?.audio
  if (!audio || typeof audio.data !== "string" || audio.data.length === 0) {
    throw new XiaomiError("no_audio", "小米 MiMo 没返回音频数据,接口可能有变。", json)
  }
  const format = audio.format === "wav" || audio.format === "mp3" || audio.format === "pcm16" ? audio.format : "wav"
  return { data: audio.data, format }
}

/**
 * 从 chat completion 响应里抽 text content(ASR / 普通 LLM 输出)。
 */
export function extractText(json: any): string {
  const content = json?.choices?.[0]?.message?.content
  if (typeof content === "string" && content.length > 0) return content
  // 多模态 message 可能返数组,降级 join
  if (Array.isArray(content)) {
    const text = content
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n")
    if (text) return text
  }
  throw new XiaomiError("no_text", "小米 MiMo 没返回文本内容,接口可能有变。", json)
}
