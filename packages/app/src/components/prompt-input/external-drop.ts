// [fork-only] 外部拖入的路由决策 [feat: external-drop-path-ref] 2026-08-14
//
// 背景:外部拖入(访达)与文件树内拖入是**两条完全不同的路径** ——
//   · 文件树内拖 → 传**路径** `{type:"file", path, content:"@path"}`,agent 用 read 工具自己读,
//     无类型限制;
//   · 外部拖    → 传**内容**,整个文件读成 base64 内联进消息,受 `attachmentMime()` 白名单
//     (图片 / pdf / text/* / 文本嗅探)+ 20MB 上限约束。
// 于是 `.csv` 能进(算 text/*)、`.docx` 进不去(二进制嗅探失败)。
//
// 而外部拖**其实已经拿到了真实路径**(`getPathForFile` → `sourcePath`),只是没拿它当引用用。
// 本模块就是把这条线接上:非图片一律改走路径引用,图片保持内联。
//
// 为什么抽成纯函数:系统级拖放(NSDragging)不经过 renderer,CDP 的 `dispatchDragEvent`
// 只能模拟页面内拖拽,**喂不进跨进程的文件拖放**(见 smoke/MANUAL-CHECKLIST.md #9a)。
// 也就是说这段路由逻辑 e2e 原理上覆盖不到,只能靠单测钉死 —— 所以它必须是可离线测的纯函数。

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

/**
 * 决定一个外部拖入的文件走哪条路。顺序即优先级:
 *
 * 1. **是图片 → 内联**。视觉模型要的是字节;而且粘贴截图本来就没有路径。
 * 2. **拿得到路径 → 路径引用**。这是本次改动的核心:任何类型都能进来。
 * 3. 其余 → 内联,回落到原有 `attachmentMime` 白名单(行为与改动前一致)。
 *
 * 第 3 条不能省:从浏览器拖来的虚拟文件、剪贴板粘贴都没有真实路径,
 * 若一律要求路径,这些今天能用的场景会直接坏掉。
 */
export function routeExternalDrop(file: { type?: string; name?: string; path?: string }): DropRoute {
  if (isImageDrop(file)) return { kind: "inline" }
  const path = file.path?.trim()
  if (!path) return { kind: "inline" }
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
