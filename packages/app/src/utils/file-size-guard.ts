// FORK: 大文件预览统一防护 — pure helper(无 SolidJS context 依赖,可单测)
// [feat: large-file-preview-guard] 2026-05-21
//
// 设计要点:
// - 按文件 ext 分类,每类一个 size 限额;入口闸门 `context/file.tsx` load() pre-check
// - "media"(视频/音频/图片)走 localasset:// HTTP Range 分片读取,size 无限制
// - "binary" 后端已经返回空 content,不进 JS 内存,无需限制
// - 其他类(text / markdown / html / office)防 V8 heap OOM + parser AST 爆炸
//
// 阈值依据:
// - text/markdown 10MB 对齐 file-limits.ts MAX_EDITABLE_BYTES + file-tabs.tsx HTML_PREVIEW_MAX_BYTES
// - office 1GB(2026-06-03 200MB→1GB,lo-bundle 捆绑 LibreOffice 后实测放宽):LibreOffice 在
//   sidecar 进程转 PDF,frontend 只拿 PDF 引用(OFFICE_PDF_REF_MIME),webview V8 不直接背锅,
//   前端不是瓶颈。真天花板是后端转换耗时(libreoffice.ts CONVERSION_TIMEOUT_MS,配套 30s→120s)。
//   实测 314MB pptx 转 PDF 仅 19s;1GB 覆盖一切真实文档,极端 GB 级异常文件仍拦(提前告知优于
//   转半天超时失败),且 1GB 上限保证不会真转 10 分钟拖垮飞书桥接 / chat 等其他 plugin。
//   注:前端阈值必须与后端 timeout 匹配 — 放行了却转不成 = 更差体验。
// - default 100MB:兜底未分类文件,WebView 内存能扛上限的保守估计

const MB = 1024 * 1024

export type SizeCategory = "text" | "markdown" | "media" | "office" | "html" | "binary" | "default"

export const SIZE_LIMITS: Record<SizeCategory, number> = {
  text: 10 * MB,
  markdown: 10 * MB,
  media: Number.POSITIVE_INFINITY, // localasset 分片读,N/A
  office: 1024 * MB, // 1GB — 配套 libreoffice.ts 后端 120s 转换超时(2026-06-03 lo-bundle 放宽)
  html: 10 * MB,
  binary: Number.POSITIVE_INFINITY, // backend 返空 content,N/A
  default: 100 * MB,
}

// 扩展名归类。优先级与 file-tabs.tsx renderFile 分流一致:markdown > media > html > office > binary > text > default
const MARKDOWN_EXTS = [".md", ".markdown"]
const MEDIA_EXTS = [
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".mp3",
  ".m4a",
  ".wav",
  ".aac",
  ".ogg",
  ".oga",
  ".opus",
  ".flac",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".ico",
]
const HTML_EXTS = [".html", ".htm"]
const OFFICE_EXTS = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".rtf", ".odt", ".ods", ".odp", ".pdf"]
const BINARY_EXTS = [
  ".pdf", // 走 office 通道转 PDF,但 raw .pdf 也算 binary 路径
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".wasm",
  ".class",
  ".jar",
  ".pyc",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
]

export function categoryOf(filePath: string | undefined): SizeCategory {
  if (!filePath) return "default"
  const lower = filePath.toLowerCase()
  if (MARKDOWN_EXTS.some((e) => lower.endsWith(e))) return "markdown"
  if (MEDIA_EXTS.some((e) => lower.endsWith(e))) return "media"
  if (HTML_EXTS.some((e) => lower.endsWith(e))) return "html"
  if (OFFICE_EXTS.some((e) => lower.endsWith(e))) return "office"
  if (BINARY_EXTS.some((e) => lower.endsWith(e))) return "binary"
  return "text"
}

export function limitFor(filePath: string | undefined): number {
  return SIZE_LIMITS[categoryOf(filePath)]
}

export function tooLargeFor(filePath: string | undefined, sizeBytes: number): boolean {
  const limit = limitFor(filePath)
  if (!Number.isFinite(limit)) return false
  return sizeBytes > limit
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`
  const gb = 1024 * MB
  if (bytes < gb) return `${(bytes / MB).toFixed(1)} MB`
  return `${(bytes / gb).toFixed(2)} GB`
}
