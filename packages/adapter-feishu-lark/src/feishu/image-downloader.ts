// FORK: 飞书图片下载到本地 workspace
// 反向于 file-uploader.ts(那是 DeskFox → 飞书);本笔是 飞书 → DeskFox
// [feat: feishu-image-recognition] 2026-05-26
//
// 实现关键(矫正经验,参 feishu-attach-upload-robustness):
//   - 绕 SDK 的 image.get(避免 axios + Buffer interop 全部坑)
//   - 直接 Bun fetch + tenant_access_token bearer auth
//   - 落盘到 ~/.opencode/imbot-workspace/feishu-images/<chatId>/<ts>-<image_key>.<ext>
//
// 落盘 → FilePart `url: file://<absolutePath>` → opencode-cli prompt.ts:1230 自动
// readFile + base64 inline 给 LLM provider。0 临时 server / 0 端口 / 0 R6 风险。

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { IMBOT_WORKSPACE } from "../plugin"

export const FEISHU_IMAGES_DIR = join(IMBOT_WORKSPACE, "feishu-images")

export interface DownloadedImage {
  /** absolute path on local fs(供 file:// URL 构造)*/
  absolutePath: string
  /** mime detected from response Content-Type */
  mime: string
  /** size in bytes(便于日志 / 大小限制兜底)*/
  size: number
  /** suggested filename(供 FilePart.filename)*/
  filename: string
}

/**
 * 飞书图片下载。返回本地 absolute path。失败抛 Error 含可读原因。
 *
 * 参数:
 *   - imageKey:飞书 image_key,从 message event content JSON 提取
 *   - chatId:聊天 ID,用作子目录分类
 *   - tenantAccessToken:飞书 tenant_access_token(用 file-uploader 的
 *     getClientAuthContext(client) 从 SDK Client 借)
 *   - domain:飞书 API domain(可选,默认国际版 open.feishu.cn;
 *     企业自建可能 open.larksuite.com)
 */
export async function downloadFeishuImage(
  imageKey: string,
  chatId: string,
  tenantAccessToken: string,
  domain = "https://open.feishu.cn",
): Promise<DownloadedImage> {
  const url = `${domain}/open-apis/im/v1/images/${encodeURIComponent(imageKey)}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tenantAccessToken}` },
  })
  if (!res.ok) {
    throw new Error(
      `飞书图片下载失败 ${res.status} ${res.statusText} for image_key=${imageKey}`,
    )
  }
  const rawCt = res.headers.get("content-type") || "image/jpeg"
  // 去掉 charset=... 等参数,只取主类型
  const mime = rawCt.split(";")[0]?.trim() || "image/jpeg"
  const ext = mimeToExt(mime)
  const buf = Buffer.from(await res.arrayBuffer())

  // chatId 可能含特殊字符(`oc_xxx` 安全;但 `om_xxx:test` 或路径分隔符要 sanitize 防目录遍历)
  const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, "_")
  const dir = join(FEISHU_IMAGES_DIR, safeChatId)
  await mkdir(dir, { recursive: true })

  const ts = timestampForFilename()
  const keyPrefix = imageKey.slice(0, 12).replace(/[^a-zA-Z0-9_-]/g, "_")
  const filename = `${ts}-${keyPrefix}.${ext}`
  const absolutePath = join(dir, filename)
  await writeFile(absolutePath, buf)

  return { absolutePath, mime, size: buf.length, filename }
}

/** YYYYMMDDHHMMSS 格式 timestamp(避免 ISO 字符串的 `:` 跨平台不友好)*/
export function timestampForFilename(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  )
}

export function mimeToExt(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/gif":
      return "gif"
    case "image/webp":
      return "webp"
    case "image/svg+xml":
      return "svg"
    case "image/bmp":
      return "bmp"
    case "image/avif":
      return "avif"
    default:
      return "bin"
  }
}
