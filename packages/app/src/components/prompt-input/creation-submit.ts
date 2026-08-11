// FORK: 创作模式「提交」编排 — legacy composer 与 v2 composer 共用 [feat: media-creation-mode]
//
// 背景(2026-08-11,upstream-sync-2026-08 验收发现):上游 v1.17.19+ 把 v2 界面设为默认,
// 新会话页与会话内 composer 都改走 `prompt-input-v2`,而创作模式的送单逻辑当时只内联在
// legacy `prompt-input.tsx` 里 → v2 默认后创作模式实际不可达。
// 修法不是在 v2 里复制一份,而是把编排抽成本文件(helper extract 模式 → 进 Logic 清单),
// 两个 composer 都调它,后续任何一侧改动不会再单边漂移。
//
// 只做编排,不碰 DOM:parts 从哪来、prompt 怎么清空,由调用方以回调注入。

import type { ContentPart } from "@/context/prompt"
import { buildCreationInput, type CreationCapability } from "./creation-input"

/** 参考图解析:图生图 / 图生视频要把附件 blob 解回 base64 dataUrl 再送厂商 API。
 *  (上游 v1.18.16 起附件从 dataUrl 改成 BlobReference,故必须先 fetch 回来。) */
export async function resolveReferenceImage(
  parts: ContentPart[],
  capability: CreationCapability,
  deps?: { fetchBlob?: (url: string) => Promise<Blob>; readAsDataUrl?: (blob: Blob) => Promise<string> },
): Promise<string | undefined> {
  if (capability !== "image_edit" && capability !== "video_i2v") return undefined
  const imagePart = parts.find((p) => p.type === "image")
  if (!imagePart || !("blob" in imagePart)) return undefined
  const url = (imagePart as { blob: { url: string } }).blob.url
  const fetchBlob = deps?.fetchBlob ?? ((u: string) => fetch(u).then((r) => r.blob()))
  const readAsDataUrl =
    deps?.readAsDataUrl ??
    ((blob: Blob) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      }))
  return await fetchBlob(url)
    .then(readAsDataUrl)
    .catch(() => undefined)
}

/** creation store 里本编排用到的那一小块(便于单测传 mock,不必造整个 store)。 */
export type CreationSubmitStore = {
  selectedModel: (cap: CreationCapability) => unknown | undefined
  currentVoice: (cap: CreationCapability) => string | undefined
  voiceDesignHint: () => string | undefined
  runCreation: (entry: never, input: ReturnType<typeof buildCreationInput>, projectDir?: string) => Promise<unknown>
}

export type CreationSubmitContext = {
  creation: CreationSubmitStore
  /** 当前 prompt 的 parts(送单前快照) */
  parts: () => ContentPart[]
  /** 当前项目根目录 — 决定产物落盘位置 */
  projectDir: () => string
  /** 清空输入框 + prompt store(两侧实现不同,故注入) */
  reset: () => void
  /** 单测注入用 */
  resolveImage?: typeof resolveReferenceImage
}

/**
 * 送一单创作生成。
 * @returns true = 已受理(调用方应吞掉本次 submit);false = 无可用模型,未受理(调用方可回落普通发送)
 */
export async function submitCreation(capability: CreationCapability, ctx: CreationSubmitContext): Promise<boolean> {
  const entry = ctx.creation.selectedModel(capability)
  if (!entry) return false

  const parts = ctx.parts()
  const resolve = ctx.resolveImage ?? resolveReferenceImage
  const imageDataUrl = await resolve(parts, capability)

  const input = buildCreationInput({
    parts,
    capability,
    imageDataUrl,
    projectDir: ctx.projectDir(),
    voice: capability === "tts" ? ctx.creation.currentVoice(capability) : undefined,
    targetLang: capability === "translate" ? "English" : undefined,
    voiceDesignHint: capability === "tts_design" ? ctx.creation.voiceDesignHint() : undefined,
  })

  // 先清空再跑:生成是长任务,输入框不该卡着上一单的文字。
  ctx.reset()
  await ctx.creation.runCreation(entry as never, input, ctx.projectDir())
  return true
}
