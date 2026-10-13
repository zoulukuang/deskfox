// Fork-only: external attachments route only after MIME normalization and connection verification.
/** 内联 = 走原有附件通道(base64);路径 = 走 `@path` 引用,由 agent 自己读。 */
export type DropRoute = { kind: "path"; path: string } | { kind: "inline" }

/** 与 `constants/file-picker.ts` 的 ACCEPTED_IMAGE_TYPES 对齐 */
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"])

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".")
  if (index === -1) return ""
  return name.slice(index + 1).toLowerCase()
}

/** 浏览器给的 mime 可能带参数(`image/png; charset=…`)或干脆为空,两种都要兜住。 */
export function isImageDrop(file: { type?: string; name?: string }): boolean {
  const mime = (file.type ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? ""
  if (IMAGE_MIMES.has(mime)) return true
  return IMAGE_EXTS.has(extensionOf(file.name ?? ""))
}

/** Only verified local text can become a reference. PDFs/images stay inline; unsupported types are rejected by admission. */
export function routeExternalDrop(file: { type?: string; name?: string; path?: string; local?: boolean }): DropRoute {
  const path = file.path
  if (file.type !== "text/plain" || !file.local || !path?.trim()) return { kind: "inline" }
  return { kind: "path", path }
}

/**
 * 图片能力拦截**只该拦图片**。
 *
 * [bug-repro: 原实现 `if (input.isImageBlocked?.())` 不看文件类型 —— 模型不支持图片时,
 *  连 .txt / .csv 也被拦下并弹「模型不支持图片」。此前被 `attachmentMime` 白名单掩盖着
 *  不易察觉;档一放开外部拖入类型后会立刻暴露。]
 *
 * 抽成纯函数,是因为 `attachments.ts` 连着 solid-js / context —— 在 bun test 里
 * import 整个模块会抛 client-only 错误(仓内 `file-tree.test.ts` 早有同样结论:
 * 「直接从纯逻辑 helper import,不再 import 整个组件」)。判定必须下沉到可离线测的地方。
 */
export function shouldBlockAsImage(mime: string, imageBlocked: boolean): boolean {
  return imageBlocked && mime.startsWith("image/")
}

/**
 * 一批附件**全被拒**时该弹哪种提示。
 *
 * 同一个毛病在聚合层也有一份:不看类型就弹「模型不支持图片」——
 * 一批全是 .txt 被拒时,用户会看到一句莫名其妙的图片提示。
 */
export function rejectionToastKind(
  files: { type?: string; name?: string }[],
  imageBlocked: boolean,
): "image-unsupported" | "unsupported" {
  if (imageBlocked && files.some((file) => isImageDrop(file))) return "image-unsupported"
  return "unsupported"
}
