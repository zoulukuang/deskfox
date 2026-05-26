// [fork-only] media-gen — 本地文件 → DashScope 临时 OSS 链接
// [feat: media-gen-alibaba] 2026-05-26
//
// ASR/改图/图生视频的输入可能是用户本地文件(file:// 或绝对路径),阿里云端够不着。
// 流程(probe-upload.ts 已实测):getPolicy → multipart 传到 OSS → 返回 oss:// 链接。
// 用 oss:// 链接调用接口时必须带头 X-DashScope-OssResourceResolve: enable(见 needsResolveHeader)。

import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { fileURLToPath } from "node:url"
import { DASHSCOPE_BASE, DashScopeError } from "./dashscope-task"

export function isRemoteUrl(s: string): boolean {
  return /^(https?|oss):\/\//i.test(s)
}

/** oss:// 链接调用 DashScope 接口时要带 X-DashScope-OssResourceResolve 头 */
export function needsResolveHeader(s: string): boolean {
  return /^oss:\/\//i.test(s)
}

function toLocalPath(p: string): string {
  if (p.startsWith("file://")) {
    try {
      return fileURLToPath(p)
    } catch {
      return decodeURIComponent(p.replace(/^file:\/\//, ""))
    }
  }
  return p
}

async function uploadLocalFile(opts: {
  apiKey: string
  localPath: string
  model: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch

  // 1) 拿上传凭证
  const polRes = await fetchImpl(
    `${DASHSCOPE_BASE}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(opts.model)}`,
    { headers: { Authorization: `Bearer ${opts.apiKey}` } },
  )
  const pol = (await polRes.json().catch(() => ({})))?.data
  if (!pol?.upload_host) throw new DashScopeError("upload_policy_failed", "获取阿里上传凭证失败。", pol)

  // 2) 读本地文件
  let bytes: Buffer
  try {
    bytes = readFileSync(opts.localPath)
  } catch (e) {
    throw new DashScopeError("file_not_found", `读不到本地文件:${opts.localPath}`, e)
  }

  // 3) multipart 上传到 OSS(file 字段必须最后)
  const filename = basename(opts.localPath) || "file"
  const key = `${pol.upload_dir}/${filename}`
  const form = new FormData()
  form.append("key", key)
  form.append("policy", pol.policy)
  form.append("OSSAccessKeyId", pol.oss_access_key_id)
  form.append("signature", pol.signature)
  form.append("x-oss-object-acl", pol.x_oss_object_acl)
  form.append("x-oss-forbid-overwrite", pol.x_oss_forbid_overwrite)
  form.append("success_action_status", "200")
  form.append("file", new Blob([new Uint8Array(bytes)]), filename)

  const up = await fetchImpl(pol.upload_host, { method: "POST", body: form })
  if (up.status >= 300) {
    throw new DashScopeError("upload_failed", "上传文件到阿里临时存储失败。", await up.text().catch(() => ""))
  }
  return `oss://${key}`
}

/**
 * 把"可能是本地路径"的输入变成 DashScope 能用的 URL:
 *   - http(s):// 或 oss:// → 原样返回
 *   - 本地路径 / file:// → 上传后返回 oss:// 链接
 */
export async function resolveInputUrl(opts: {
  apiKey: string
  input: string
  model: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  if (isRemoteUrl(opts.input)) return opts.input
  return uploadLocalFile({
    apiKey: opts.apiKey,
    localPath: toLocalPath(opts.input),
    model: opts.model,
    fetchImpl: opts.fetchImpl,
  })
}
