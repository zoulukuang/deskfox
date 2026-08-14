// FORK: 创作模式提交时,把 prompt parts 组装成 media-gen 后端要的 input
// (refFile/audioUrl 按 capability 路由,@<path> 文件引用解析为绝对路径,prompt 剔除 @<path>/@<agent> 字面)
// helper extract 模式 → 进 Logic 清单,便于单测 bug-repro。
// [fix: creation-edit-asr-no-file] [bug-repro: 创作模式 @<路径> 没塞进 refFile/audioUrl] 2026-05-28

import type { ContentPart, FileAttachmentPart, ImageAttachmentPart, TextPart } from "@/context/prompt"

/** 复用 build-request-parts 同款逻辑:相对 → 绝对(Win 盘符 / UNC / POSIX 兼容)。对已绝对路径 idempotent。 */
export function absolutePath(directory: string, p: string): string {
  if (p.startsWith("/")) return p
  if (/^[A-Za-z]:[\\/]/.test(p) || /^[A-Za-z]:$/.test(p)) return p
  if (p.startsWith("\\\\") || p.startsWith("//")) return p
  return `${directory.replace(/[\\/]+$/, "")}/${p}`
}

/** 创作模式 capability 集合(跟 packages/media-gen/src/dispatch.ts GenInput 对齐)*/
// FORK: 加 tts_clone / tts_design [feat: media-gen-xiaomi] 2026-05-28
export type CreationCapability =
  | "image"
  | "image_edit"
  | "video"
  | "video_i2v"
  | "tts"
  | "tts_clone"
  | "tts_design"
  | "asr"
  | "translate"

/** 创作模式提交给 server 的 input(对齐 GenInput)。 */
export type CreationInput = {
  prompt: string
  refFile?: string
  audioUrl?: string
  voice?: string
  targetLang?: string
  // FORK: VoiceDesign 声线描述 [feat: media-gen-xiaomi] 2026-05-28
  voiceDesignHint?: string
}

export type BuildCreationInputArgs = {
  imageDataUrl?: string
  parts: ContentPart[]
  capability: CreationCapability
  projectDir: string
  voice?: string
  targetLang?: string
  // FORK: VoiceDesign 输入框值 [feat: media-gen-xiaomi] 2026-05-28
  voiceDesignHint?: string
}

/**
 * 把 prompt 的 parts + 当前 capability 组装成后端 /generate 要的 input。
 *
 * 规则:
 * - prompt 文本**只取 `text` part**:`file`/`agent` 的 "@<x>" 字面不进 prompt,避免污染厂商 API。
 * - 第一个 `file` part 的 `path` 走 `absolutePath` 拼绝对,按 capability 路由:
 *   - `image_edit` / `video_i2v` → `refFile`
 *   - `asr` → `audioUrl`
 *   - 其他 capability → 忽略(它们不需文件)
 * - 兼容旧附件通道:`image_edit`/`video_i2v` 没 file part 时回落到 `+号` 附件的 base64 dataUrl(向后兼容)。
 * - 多个 file part → 取**第一个**(MVP)。
 */
export function buildCreationInput(args: BuildCreationInputArgs): CreationInput {
  const { parts, capability, projectDir, voice, targetLang, voiceDesignHint } = args

  // 1. prompt:剔除 file/agent 的 "@<x>" 字面
  const prompt = parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.content)
    .join("")
    .trim()

  const input: CreationInput = { prompt }

  // 2. file part 优先(用户显式 @<path> 引用,意图最明确)
  const filePart = parts.find((p): p is FileAttachmentPart => p.type === "file")
  const imagePart = parts.find((p): p is ImageAttachmentPart => p.type === "image")

  if (capability === "image_edit" || capability === "video_i2v") {
    if (filePart?.path) {
      input.refFile = absolutePath(projectDir, filePart.path)
    } else if (args.imageDataUrl) {
      // FORK: 2026-08-11 sync v1.18.16 — 上游 blob 化附件(ImageAttachmentPart.dataUrl → blob),
      //   base64 由调用方(submitCreation)异步解出后经此参数传入,保持本函数纯同步可单测
      input.refFile = args.imageDataUrl
    }
  } else if (capability === "asr") {
    if (filePart?.path) {
      input.audioUrl = absolutePath(projectDir, filePart.path)
    }
  } else if (capability === "tts_clone") {
    // FORK: 语音克隆复用 refFile 字段传参考音频路径(媒体后端会读字节构 DataURL)
    // [feat: media-gen-xiaomi] 2026-05-28
    if (filePart?.path) {
      input.refFile = absolutePath(projectDir, filePart.path)
    }
  }

  if (capability === "tts" && voice) input.voice = voice
  if (capability === "translate" && targetLang) input.targetLang = targetLang
  // FORK: 语音设计的声线描述 [feat: media-gen-xiaomi] 2026-05-28
  if (capability === "tts_design" && voiceDesignHint) input.voiceDesignHint = voiceDesignHint

  return input
}
