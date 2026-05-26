// [fork-only] media-gen — 本地文件 / data URL → DashScope 临时 OSS 链接
// [feat: media-gen-alibaba] 2026-05-26
//
// 输入可能是:本地路径(file:// / 绝对路径)、base64 data URL(前端附件)、或已是公网/oss URL。
// 阿里云端够不着本地数据 → 走 getPolicy → multipart 传 OSS → 返回 oss:// 链接(调用时带
// X-DashScope-OssResourceResolve 头,见 needsResolveHeader)。

import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { fileURLToPath } from "node:url"
import { DASHSCOPE_BASE, DashScopeError } from "./dashscope-task"

export function isRemoteUrl(s: string): boolean {
  return /^(https?|oss):\/\//i.test(s)
}

export function isDataUrl(s: string): boolean {
  return /^data:/i.test(s)
}

/** oss:// 链接调用 DashScope 接口时要带 X-DashScope-OssResourceResolve 头 */
export function needsResolveHeader(s: string): boolean {
  return /^oss:\/\//i.test(s)
}

export function toLocalPath(p: string): string {
  if (p.startsWith("file://")) {
    try {
      return fileURLToPath(p)
    } catch {
      return decodeURIComponent(p.replace(/^file:\/\//, ""))
    }
  }
  return p
}

/** 解析 data URL → 字节 + 扩展名 */
function decodeDataUrl(dataUrl: string): { bytes: Buffer; ext: string } {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(dataUrl)
  if (!m) throw new DashScopeError("bad_data_url", "无法解析图片数据(data URL)。")
  const mime = m[1] ?? "image/png"
  const bytes = m[2] ? Buffer.from(m[3] ?? "", "base64") : Buffer.from(decodeURIComponent(m[3] ?? ""), "utf-8")
  const ext = (mime.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "") || "png"
  return { bytes, ext }
}

/** 把字节上传到 DashScope 临时 OSS,返回 oss:// 链接 */
async function uploadBytes(opts: {
  apiKey: string
  bytes: Uint8Array
  filename: string
  model: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const polRes = await fetchImpl(
    `${DASHSCOPE_BASE}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(opts.model)}`,
    { headers: { Authorization: `Bearer ${opts.apiKey}` } },
  )
  const pol = (await polRes.json().catch(() => ({})))?.data
  if (!pol?.upload_host) throw new DashScopeError("upload_policy_failed", "获取阿里上传凭证失败。", pol)

  const key = `${pol.upload_dir}/${opts.filename}`
  const form = new FormData()
  form.append("key", key)
  form.append("policy", pol.policy)
  form.append("OSSAccessKeyId", pol.oss_access_key_id)
  form.append("signature", pol.signature)
  form.append("x-oss-object-acl", pol.x_oss_object_acl)
  form.append("x-oss-forbid-overwrite", pol.x_oss_forbid_overwrite)
  form.append("success_action_status", "200")
  form.append("file", new Blob([new Uint8Array(opts.bytes)]), opts.filename) // file 字段必须最后

  const up = await fetchImpl(pol.upload_host, { method: "POST", body: form })
  if (up.status >= 300) {
    throw new DashScopeError("upload_failed", "上传文件到阿里临时存储失败。", await up.text().catch(() => ""))
  }
  return `oss://${key}`
}

/**
 * 把"可能是本地/内联数据"的输入变成 DashScope 能用的 URL:
 *   - http(s):// 或 oss:// → 原样返回
 *   - data:...;base64 → 解码后上传 → oss://
 *   - 本地路径 / file:// → 读文件上传 → oss://
 */
export async function resolveInputUrl(opts: {
  apiKey: string
  input: string
  model: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  if (isRemoteUrl(opts.input)) return opts.input

  if (isDataUrl(opts.input)) {
    const { bytes, ext } = decodeDataUrl(opts.input)
    return uploadBytes({ apiKey: opts.apiKey, bytes, filename: `upload.${ext}`, model: opts.model, fetchImpl: opts.fetchImpl })
  }

  const localPath = toLocalPath(opts.input)
  let bytes: Buffer
  try {
    bytes = readFileSync(localPath)
  } catch (e) {
    throw new DashScopeError("file_not_found", `读不到本地文件:${localPath}`, e)
  }
  return uploadBytes({
    apiKey: opts.apiKey,
    bytes: new Uint8Array(bytes),
    filename: basename(localPath) || "file",
    model: opts.model,
    fetchImpl: opts.fetchImpl,
  })
}
