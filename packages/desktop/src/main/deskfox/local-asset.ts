// FORK-ONLY: DeskFox 本地资源协议 localasset:// [feat: electron-replatform] 2026-06-12
//
// 从 Tauri local_asset.rs 平移。文件查看器的图片/音视频/HTML 预览经此协议读本地文件。
// URL: localasset://localhost/<base64url-root>/<rel-path>
//   - base64url-root: URL-safe base64(无 padding)编码的 sdk 根目录绝对路径
//   - rel-path: 相对 root 的文件路径(forward slash)
// 安全: realpath(root+rel) 必须 startsWith realpath(root) —— 解 ../ 与符号链接后越权防护;
//       绝对路径 / 跨盘符引用 startsWith 不通过 → 403。
// Electron/Chromium 支持全平台自定义 scheme(Tauri WebView2 在 Win 要用假 http host,这里统一 localasset://)。

import fs from "fs"
import fsp from "fs/promises"
import path from "path"
import { protocol } from "electron"

export const LOCAL_ASSET_SCHEME = "localasset"
const MAX_BYTES = 500 * 1024 * 1024 // 500MB 硬上限(对齐 Rust)

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
  pdf: "application/pdf", html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8", json: "application/json",
}
function mimeFor(p: string): string {
  return MIME[path.extname(p).slice(1).toLowerCase()] ?? "application/octet-stream"
}

function b64urlDecode(s: string): string | null {
  try {
    return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
  } catch {
    return null
  }
}

/** 把 root 内 rel 解析成绝对路径并做越权终审;不在 root 内返 null。 */
function resolveSafe(root: string, rel: string): string | null {
  let realRoot: string
  try {
    realRoot = fs.realpathSync(root)
  } catch {
    return null
  }
  const target = path.resolve(realRoot, rel)
  let realTarget: string
  try {
    realTarget = fs.realpathSync(target)
  } catch {
    return null
  }
  const rootWithSep = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep
  if (realTarget !== realRoot && !realTarget.startsWith(rootWithSep)) return null
  return realTarget
}

async function handle(request: Request): Promise<Response> {
  // URL: localasset://localhost/<b64root>/<relpath>
  const url = new URL(request.url)
  const pathname = decodeURIComponent(url.pathname.replace(/^\//, "")) // <b64root>/<relpath>
  const slash = pathname.indexOf("/")
  if (slash < 0) return new Response("bad url", { status: 400 })
  const rootB64 = pathname.slice(0, slash)
  const rel = pathname.slice(slash + 1)
  const root = b64urlDecode(rootB64)
  if (!root) return new Response("bad root", { status: 400 })
  const file = resolveSafe(root, rel)
  if (!file) return new Response("forbidden", { status: 403 })

  let st: fs.Stats
  try {
    st = await fsp.stat(file)
  } catch {
    return new Response("not found", { status: 404 })
  }
  if (!st.isFile()) return new Response("not a file", { status: 404 })
  if (st.size > MAX_BYTES) return new Response("too large", { status: 413 })

  const mime = mimeFor(file)
  const range = request.headers.get("range")
  // Range 请求(视频/音频 seek)→ 206
  const m = range && /bytes=(\d*)-(\d*)/.exec(range)
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0
    const end = m[2] ? parseInt(m[2], 10) : st.size - 1
    const chunk = await new Promise<Buffer>((resolve, reject) => {
      const bufs: Buffer[] = []
      fs.createReadStream(file, { start, end })
        .on("data", (d) => bufs.push(d as Buffer))
        .on("end", () => resolve(Buffer.concat(bufs)))
        .on("error", reject)
    })
    return new Response(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer, {
      status: 206,
      headers: {
        "content-type": mime,
        "content-range": `bytes ${start}-${end}/${st.size}`,
        "accept-ranges": "bytes", "access-control-allow-origin": "*",
        "content-length": String(chunk.length),
      },
    })
  }
  // 全量:走 net.fetch file:// 流式(避免大文件全读进内存)
  const data = await fsp.readFile(file)
  return new Response(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, {
    headers: { "content-type": mime, "accept-ranges": "bytes", "access-control-allow-origin": "*", "content-length": String(data.length) },
  })
}

/** app.whenReady 后调用,注册 protocol.handle。 */
export function registerLocalAssetProtocol() {
  protocol.handle(LOCAL_ASSET_SCHEME, (request) => handle(request).catch(() => new Response("error", { status: 500 })))
}
