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
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"

// FORK: 不 import IMBOT_WORKSPACE from "../plugin" 避免循环依赖
// (plugin → message-pipeline → image-downloader → plugin)
// 自己重算同样的路径(plugin.ts:55 也是 join(homedir(), ".opencode", "imbot-workspace"))
const IMBOT_WORKSPACE = join(homedir(), ".opencode", "imbot-workspace")
// 全局默认收件图片根(per-account workspace 未设时的 fallback)。
// 越界保护已改为函数内按传入 imagesRoot 现算(用 path.sep 做子树前缀,Windows 反斜杠安全)。
export const FEISHU_IMAGES_DIR = join(IMBOT_WORKSPACE, "feishu-images")

// [feat: feishu-image-recognition] S1 大小硬限 — LLM API 限制(Claude 5MB / OpenAI 20MB),
// 取 20MB 上限既兼容 OpenAI,Claude 失败时 LLM 自己报错复述给 user
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

// [feat: feishu-image-recognition] S2 fetch timeout — 飞书 API hang 不要永远卡死
export const FETCH_TIMEOUT_MS = 30_000

// [feat: feishu-image-recognition] S3 mime allowlist — 防飞书 API 返非图二进制 / 攻击 / API 错乱
// 跟 LLM vision 普遍支持的格式对齐(SVG 多数 LLM 不支持但飞书允许发,这里放行 LLM 自己判)
export const ALLOWED_MIMES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/avif",
])

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
 * **重要**:用户上传的图片必须走 message resources endpoint:
 *   `GET /open-apis/im/v1/messages/{message_id}/resources/{file_key}?type=image`
 * 不能走 `/images/{image_key}`(那是 bot 自己上传图的下载端点,对用户图返 400)
 *
 * 参数:
 *   - imageKey:飞书 image_key,从 message event content JSON 提取(同 file_key)
 *   - messageId:飞书 message_id(om_xxx),消息维度资源 access
 *   - chatId:聊天 ID,用作子目录分类
 *   - tenantAccessToken:飞书 tenant_access_token
 *   - domain:飞书 API domain(可选,默认国际版 open.feishu.cn)
 *   - imagesRoot:落盘根目录(可选,默认全局 FEISHU_IMAGES_DIR;per-account workspace 传
 *     `<ws>/_deskfox/feishu/images`)。越界保护对此 root 现算。[feat: feishu-account-workspace]
 */
export async function downloadFeishuImage(
  imageKey: string,
  messageId: string,
  chatId: string,
  tenantAccessToken: string,
  domain = "https://open.feishu.cn",
  imagesRoot: string = FEISHU_IMAGES_DIR,
): Promise<DownloadedImage> {
  const url = `${domain}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(imageKey)}?type=image`

  // [feat: feishu-image-recognition] S2 fetch 加 timeout(AbortController)
  const ctrl = new AbortController()
  const timeoutHandle = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${tenantAccessToken}` },
      signal: ctrl.signal,
    })
  } catch (err) {
    clearTimeout(timeoutHandle)
    const isAbort = (err as Error).name === "AbortError"
    throw new Error(
      isAbort
        ? `飞书图片下载超时 (${FETCH_TIMEOUT_MS}ms) for image_key=${imageKey} message_id=${messageId}`
        // S5 不带 token 信息,只带 user 可见的标识(image_key / message_id)
        : `飞书图片下载网络错误 for image_key=${imageKey} message_id=${messageId}: ${(err as Error).message}`,
    )
  }
  clearTimeout(timeoutHandle)

  if (!res.ok) {
    throw new Error(
      `飞书图片下载失败 ${res.status} ${res.statusText} for image_key=${imageKey} message_id=${messageId}`,
    )
  }

  // S1 Content-Length 预检(若 server 返了)
  const contentLengthHeader = res.headers.get("content-length")
  if (contentLengthHeader) {
    const declaredSize = parseInt(contentLengthHeader, 10)
    if (declaredSize > MAX_IMAGE_BYTES) {
      throw new Error(
        `飞书图片过大 ${humanSize(declaredSize)} > ${humanSize(MAX_IMAGE_BYTES)} for image_key=${imageKey}`,
      )
    }
  }

  const rawCt = res.headers.get("content-type") || "image/jpeg"
  // 去掉 charset=... 等参数,只取主类型,小写化
  const mime = (rawCt.split(";")[0]?.trim() || "image/jpeg").toLowerCase()

  // S3 mime allowlist — 防飞书 API 返非图(可能因 API 错乱 / 极端攻击 / token 失效返 HTML 错误页)
  if (!ALLOWED_MIMES.has(mime)) {
    throw new Error(
      `飞书图片 mime 不在白名单 (${mime}) for image_key=${imageKey} — 期望 ${[...ALLOWED_MIMES].join(", ")}`,
    )
  }

  const ext = mimeToExt(mime)
  const buf = Buffer.from(await res.arrayBuffer())

  // S1 真大小再检一遍(无 Content-Length / Content-Length 撒谎 兜底)
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `飞书图片过大 ${humanSize(buf.length)} > ${humanSize(MAX_IMAGE_BYTES)} for image_key=${imageKey}`,
    )
  }
  if (buf.length === 0) {
    throw new Error(`飞书图片空 (0 bytes) for image_key=${imageKey}`)
  }

  // chatId 可能含特殊字符(`oc_xxx` 安全;但 `om_xxx:test` 或路径分隔符要 sanitize 防目录遍历)
  const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, "_")
  const dir = join(imagesRoot, safeChatId)

  // S4 路径越界 assert — 即使 sanitize 漏改了,resolve 后必须在 imagesRoot 子树内
  // [feat: feishu-account-workspace] root 改为按传入 imagesRoot 现算(支持 per-account workspace)
  const imagesRootResolved = resolve(imagesRoot) + sep
  const resolvedDir = resolve(dir) + sep
  if (!resolvedDir.startsWith(imagesRootResolved)) {
    throw new Error(
      `飞书图片落盘路径越界 (resolved=${resolvedDir}, root=${imagesRootResolved}) for image_key=${imageKey}`,
    )
  }

  await mkdir(dir, { recursive: true })

  const filename = makeImageFilename(imageKey, ext)
  const absolutePath = join(dir, filename)
  await writeFile(absolutePath, buf)

  return { absolutePath, mime, size: buf.length, filename }
}

/**
 * 生成本地落盘 filename:`<ts>-<key12>-<rnd6>.<ext>`
 *
 * U5 冲突防御:同 second(同 ts)+ 同 image_key 高频场景(罕见但要兜底),
 * 加 6 字符 random suffix 几乎 0 碰撞。
 */
export function makeImageFilename(imageKey: string, ext: string): string {
  const ts = timestampForFilename()
  const keyPrefix = imageKey.slice(0, 12).replace(/[^a-zA-Z0-9_-]/g, "_")
  const rnd = Math.random().toString(36).slice(2, 8)
  return `${ts}-${keyPrefix}-${rnd}.${ext}`
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
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
