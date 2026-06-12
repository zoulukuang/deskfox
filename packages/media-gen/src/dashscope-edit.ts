// [fork-only] media-gen — 阿里图像编辑(qwen-image-edit,指令编辑,效果远好于 wanx2.1-imageedit)
// [feat: media-gen-alibaba] 2026-05-26
//
// 走同步 multimodal-generation 端点,messages 格式([{image},{text}]),返回 output.choices[0].message.content[].image。
// 本地文件转 base64 data URI(实测可用,连上传都省);http(s) 直传;oss:// 带 Resolve 头。
// 选型实测:wanx2.1-imageedit 把"换背景"理解成重画对象(背景没变);qwen-image-edit 正确替换背景。

import { readFileSync } from "node:fs"
import { extname } from "node:path"
import { DASHSCOPE_BASE, DashScopeError, httpError, readJson } from "./dashscope-task"
import { toLocalPath } from "./dashscope-upload"

export const DEFAULT_EDIT_MODEL = "qwen-image-edit"
const ENDPOINT = "/api/v1/services/aigc/multimodal-generation/generation"

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
}

export type EditInput = {
  apiKey: string
  prompt: string
  image: string // 本地路径 / file:// / http(s):// / oss://
  model?: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export type EditResult = { url: string; model: string }

/** 把图片输入变成 messages 里的 image 值:远程原样;本地转 base64 data URI */
function toImageContent(image: string): { value: string; resolveHeader: boolean } {
  if (/^https?:\/\//i.test(image)) return { value: image, resolveHeader: false }
  if (/^oss:\/\//i.test(image)) return { value: image, resolveHeader: true }
  if (/^data:/i.test(image)) return { value: image, resolveHeader: false } // 前端附件 base64,qwen-image-edit 直收
  const local = toLocalPath(image)
  let bytes: Buffer
  try {
    bytes = readFileSync(local)
  } catch (e) {
    throw new DashScopeError("file_not_found", `读不到本地图片:${local}`, e)
  }
  const mime = MIME[extname(local).toLowerCase()] ?? "image/png"
  return { value: `data:${mime};base64,${bytes.toString("base64")}`, resolveHeader: false }
}

export async function editImage(input: EditInput): Promise<EditResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const model = input.model ?? DEFAULT_EDIT_MODEL
  const { value, resolveHeader } = toImageContent(input.image)

  const res = await fetchImpl(`${DASHSCOPE_BASE}${ENDPOINT}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      ...(resolveHeader ? { "X-DashScope-OssResourceResolve": "enable" } : {}),
    },
    body: JSON.stringify({
      model,
      input: { messages: [{ role: "user", content: [{ image: value }, { text: input.prompt }] }] },
    }),
    signal: input.signal,
  })
  const json = await readJson(res)
  if (!res.ok) throw httpError(res.status, json)

  const content = json?.output?.choices?.[0]?.message?.content
  let url: string | undefined
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.image && typeof part.image === "string") {
        url = part.image
        break
      }
    }
  }
  if (!url) throw new DashScopeError("no_image", "改图没拿到结果图,接口可能有变。", json)
  return { url, model }
}
