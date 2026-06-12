// [fork-only] media-gen — MiniMax 文生图(image-01,同步 POST → image_urls)
// [feat: media-gen-minimax] 2026-05-28
//
// 端点:POST /v1/image_generation
// 协议:body 含 model/prompt/aspect_ratio/response_format/n/prompt_optimizer;
//      响应 data.image_urls[](OSS 链接,带 Expires query 24h 有效)。

import { MINIMAX_BASE, MinimaxError, checkBaseResp, httpError, readJson } from "./minimax-error"

export const DEFAULT_IMAGE_MODEL = "image-01"

export type ImageInput = {
  apiKey: string
  prompt: string
  model?: string
  /** "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3"(MiniMax 接受字面比) */
  aspectRatio?: string
  n?: number
  /** 自动优化提示词,MiniMax 默认 true,显式给给空保证可关 */
  promptOptimizer?: boolean
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export type ImageResult = { urls: string[]; model: string }

/** 把"1024*1024" 旧风格 size 转 aspect_ratio(MiniMax 不用像素 size,用比) */
function sizeToAspect(size?: string): string | undefined {
  if (!size) return undefined
  const m = /^(\d+)\s*[*xX×]\s*(\d+)$/.exec(size.trim())
  if (!m) return size
  const [w, h] = [Number(m[1]), Number(m[2])]
  if (!w || !h) return undefined
  // 简单约分到 MiniMax 常用档
  if (w === h) return "1:1"
  const ratio = w / h
  if (Math.abs(ratio - 16 / 9) < 0.05) return "16:9"
  if (Math.abs(ratio - 9 / 16) < 0.05) return "9:16"
  if (Math.abs(ratio - 4 / 3) < 0.05) return "4:3"
  if (Math.abs(ratio - 3 / 4) < 0.05) return "3:4"
  if (Math.abs(ratio - 3 / 2) < 0.05) return "3:2"
  if (Math.abs(ratio - 2 / 3) < 0.05) return "2:3"
  return ratio > 1 ? "16:9" : "9:16"
}

export async function generateImage(input: ImageInput & { size?: string }): Promise<ImageResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const model = input.model ?? DEFAULT_IMAGE_MODEL
  const aspect_ratio = input.aspectRatio ?? sizeToAspect(input.size) ?? "1:1"

  const res = await fetchImpl(`${MINIMAX_BASE}/v1/image_generation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      aspect_ratio,
      response_format: "url",
      n: input.n ?? 1,
      prompt_optimizer: input.promptOptimizer ?? true,
    }),
    signal: input.signal,
  })
  const json = await readJson(res)
  if (!res.ok) throw httpError(res.status, json)
  checkBaseResp(json)

  const urls: string[] = json?.data?.image_urls ?? []
  if (!urls.length) throw new MinimaxError("no_image", "MiniMax 没返回图片链接,接口可能有变。", json)
  return { urls, model }
}
