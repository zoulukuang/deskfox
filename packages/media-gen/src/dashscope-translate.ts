// [fork-only] media-gen — 阿里专业翻译(qwen-mt,OpenAI 兼容 chat,同步)
// [feat: media-gen-alibaba] 2026-05-26

import { DashScopeError, httpError, readJson } from "./dashscope-task"

export const DEFAULT_MT_MODEL = "qwen-mt-turbo" // 高质量可传 qwen-mt-plus
const ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"

export type TranslateInput = {
  apiKey: string
  text: string
  targetLang: string // 如 "English" / "Chinese" / "Japanese"
  sourceLang?: string // 缺省 "auto" 自动识别
  model?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export type TranslateResult = { text: string; model: string }

export async function translateText(input: TranslateInput): Promise<TranslateResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const model = input.model ?? DEFAULT_MT_MODEL

  const res = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: input.text }],
      translation_options: { source_lang: input.sourceLang ?? "auto", target_lang: input.targetLang },
    }),
    signal: input.signal,
  })
  const json = await readJson(res)
  if (!res.ok) throw httpError(res.status, json)
  const text: string | undefined = json?.choices?.[0]?.message?.content
  if (!text) throw new DashScopeError("no_translation", "翻译失败,没拿到译文。", json)
  return { text, model }
}
