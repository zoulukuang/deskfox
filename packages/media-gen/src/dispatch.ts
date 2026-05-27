// [fork-only] media-gen — 派发器:把一条目录条目 + 输入,路由到对应引擎(复用现成的 dashscope-*)
// [feat: media-creation-mode] 2026-05-26
//
// "一个引擎,多个门"的统一入口:创作模式的 /generate 通道、(可选)旧 AI 工具,都经此派发。
// 它只负责"按 capability 调对引擎",不重写任何生成逻辑。

import { readProviderApiKey } from "./auth"
import type { CatalogEntry } from "./catalog"
import { DashScopeError, type TaskProgress } from "./dashscope-task"
import { generateImage } from "./dashscope-image"
import { editImage } from "./dashscope-edit"
import { generateVideo } from "./dashscope-video"
import { synthesizeSpeech } from "./dashscope-tts"
import { translateText } from "./dashscope-translate"
import { transcribeAudio } from "./dashscope-asr"

export type GenInput = {
  prompt?: string // 文本类输入(文生图/视频/配音文字/翻译原文)
  size?: string
  n?: number
  voice?: string
  targetLang?: string
  refFile?: string // 素材:参考图/首帧图(本地路径或 URL)
  audioUrl?: string // 转写音频(本地路径或 URL)
  signal?: AbortSignal
  onProgress?: (p: TaskProgress) => void
  // 仅测试注入
  fetchImpl?: typeof fetch
  pollIntervalMs?: number
  maxWaitMs?: number
}

export type GenOutput = {
  kind: "image" | "video" | "audio" | "text"
  urls?: string[]
  url?: string
  text?: string
  localPaths?: string[] // 落盘后的本地路径(由 /generate 服务端填,见 server.ts)
  model: string
  provider: string
}

export type DispatchOptions = {
  /** 仅测试注入:覆盖 auth.json 路径 */
  authPath?: string
}

export async function runEntry(entry: CatalogEntry, input: GenInput, opts?: DispatchOptions): Promise<GenOutput> {
  const apiKey = readProviderApiKey(entry.providerKey, opts?.authPath)
  if (!apiKey) throw new DashScopeError("no_key", `未找到 ${entry.provider}(${entry.providerKey})的 API Key,请先连接该供应商。`)

  const base = {
    apiKey,
    model: entry.model,
    signal: input.signal,
    fetchImpl: input.fetchImpl,
    pollIntervalMs: input.pollIntervalMs,
    maxWaitMs: input.maxWaitMs,
  }
  const meta = { model: entry.model, provider: entry.provider }

  switch (entry.capability) {
    case "image": {
      const r = await generateImage({ ...base, prompt: input.prompt ?? "", size: input.size, n: input.n, onProgress: input.onProgress })
      return { kind: "image", urls: r.urls, ...meta }
    }
    case "image_edit": {
      if (!input.refFile) throw new DashScopeError("no_ref", "图片编辑需要先提供一张图片。")
      const r = await editImage({ ...base, prompt: input.prompt ?? "", image: input.refFile })
      return { kind: "image", urls: [r.url], ...meta }
    }
    case "video": {
      const r = await generateVideo({ ...base, prompt: input.prompt ?? "", size: input.size, onProgress: input.onProgress })
      return { kind: "video", url: r.url, ...meta }
    }
    case "video_i2v": {
      if (!input.refFile) throw new DashScopeError("no_ref", "图生视频需要先提供一张首帧图。")
      const r = await generateVideo({ ...base, prompt: input.prompt ?? "", refImage: input.refFile, onProgress: input.onProgress })
      return { kind: "video", url: r.url, ...meta }
    }
    case "tts": {
      const r = await synthesizeSpeech({ ...base, text: input.prompt ?? "", voice: input.voice })
      return { kind: "audio", url: r.url, ...meta }
    }
    case "asr": {
      const audio = input.audioUrl ?? input.refFile
      if (!audio) throw new DashScopeError("no_audio", "转写需要先提供一个音频文件。")
      const r = await transcribeAudio({ ...base, audioUrl: audio, onProgress: input.onProgress })
      return { kind: "text", text: r.text, ...meta }
    }
    case "translate": {
      if (!input.targetLang) throw new DashScopeError("no_target", "翻译需要指定目标语言。")
      const r = await translateText({ ...base, text: input.prompt ?? "", targetLang: input.targetLang })
      return { kind: "text", text: r.text, ...meta }
    }
  }
}
