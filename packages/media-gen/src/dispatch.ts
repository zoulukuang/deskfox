// [fork-only] media-gen — 派发器:按 provider 路由到对应引擎
// [feat: media-creation-mode] 2026-05-26 / [feat: media-gen-minimax] 2026-05-28(改为 by-provider 路由)
//
// "一个引擎,多个门"的统一入口:创作模式的 /generate 通道、(可选)旧 AI 工具,都经此派发。
// 第一家:阿里(dashscope-*);第二家:MiniMax(minimax-*)。
// 由 entry.providerKey 决定走哪一家;每家内部再按 capability 路由。
// 第三家时该考虑抽 MediaAdapter 接口(本文件目前是"竖切打穿,不抽象")。

import { readProviderApiKey } from "./auth"
import { ALIBABA_KEY, MINIMAX_KEY, type CatalogEntry } from "./catalog"
import { DashScopeError, type TaskProgress } from "./dashscope-task"
import { generateImage as dsGenerateImage } from "./dashscope-image"
import { editImage as dsEditImage } from "./dashscope-edit"
import { generateVideo as dsGenerateVideo } from "./dashscope-video"
import { synthesizeSpeech as dsSynthesizeSpeech } from "./dashscope-tts"
import { translateText as dsTranslateText } from "./dashscope-translate"
import { transcribeAudio as dsTranscribeAudio } from "./dashscope-asr"
// FORK: MiniMax 引擎 [feat: media-gen-minimax] 2026-05-28
import { MinimaxError } from "./minimax-error"
import { generateImage as mxGenerateImage } from "./minimax-image"
import { generateVideo as mxGenerateVideo } from "./minimax-video"
import { synthesizeSpeech as mxSynthesizeSpeech } from "./minimax-tts"

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

type Base = Pick<GenInput, "signal" | "fetchImpl" | "pollIntervalMs" | "maxWaitMs"> & {
  apiKey: string
  model: string
}

export async function runEntry(entry: CatalogEntry, input: GenInput, opts?: DispatchOptions): Promise<GenOutput> {
  const apiKey = readProviderApiKey(entry.providerKey, opts?.authPath)
  const meta = { model: entry.model, provider: entry.provider }

  // 按 providerKey 路由(第二家及以后必须从这里分流)
  switch (entry.providerKey) {
    case ALIBABA_KEY: {
      if (!apiKey) throw new DashScopeError("no_key", `未找到 ${entry.provider}(${entry.providerKey})的 API Key,请先连接该供应商。`)
      const base: Base = { apiKey, model: entry.model, signal: input.signal, fetchImpl: input.fetchImpl, pollIntervalMs: input.pollIntervalMs, maxWaitMs: input.maxWaitMs }
      return dispatchAlibaba(entry, base, input, meta)
    }
    case MINIMAX_KEY: {
      if (!apiKey) throw new MinimaxError("no_key", `未找到 ${entry.provider}(${entry.providerKey})的 API Key,请先连接该供应商。`)
      const base: Base = { apiKey, model: entry.model, signal: input.signal, fetchImpl: input.fetchImpl, pollIntervalMs: input.pollIntervalMs, maxWaitMs: input.maxWaitMs }
      return dispatchMinimax(entry, base, input, meta)
    }
    default:
      throw new Error(`未知 provider: ${entry.providerKey}`)
  }
}

// ============================================================
// 阿里(dashscope)
// ============================================================
async function dispatchAlibaba(entry: CatalogEntry, base: Base, input: GenInput, meta: { model: string; provider: string }): Promise<GenOutput> {
  switch (entry.capability) {
    case "image": {
      const r = await dsGenerateImage({ ...base, prompt: input.prompt ?? "", size: input.size, n: input.n, onProgress: input.onProgress })
      return { kind: "image", urls: r.urls, ...meta }
    }
    case "image_edit": {
      if (!input.refFile) throw new DashScopeError("no_ref", "图片编辑需要先提供一张图片。")
      const r = await dsEditImage({ ...base, prompt: input.prompt ?? "", image: input.refFile })
      return { kind: "image", urls: [r.url], ...meta }
    }
    case "video": {
      const r = await dsGenerateVideo({ ...base, prompt: input.prompt ?? "", size: input.size, onProgress: input.onProgress })
      return { kind: "video", url: r.url, ...meta }
    }
    case "video_i2v": {
      if (!input.refFile) throw new DashScopeError("no_ref", "图生视频需要先提供一张首帧图。")
      const r = await dsGenerateVideo({ ...base, prompt: input.prompt ?? "", refImage: input.refFile, onProgress: input.onProgress })
      return { kind: "video", url: r.url, ...meta }
    }
    case "tts": {
      const r = await dsSynthesizeSpeech({ ...base, text: input.prompt ?? "", voice: input.voice })
      return { kind: "audio", url: r.url, ...meta }
    }
    case "asr": {
      const audio = input.audioUrl ?? input.refFile
      if (!audio) throw new DashScopeError("no_audio", "转写需要先提供一个音频文件。")
      const r = await dsTranscribeAudio({ ...base, audioUrl: audio, onProgress: input.onProgress })
      return { kind: "text", text: r.text, ...meta }
    }
    case "translate": {
      if (!input.targetLang) throw new DashScopeError("no_target", "翻译需要指定目标语言。")
      const r = await dsTranslateText({ ...base, text: input.prompt ?? "", targetLang: input.targetLang })
      return { kind: "text", text: r.text, ...meta }
    }
  }
}

// ============================================================
// MiniMax(image-01 / Hailuo-02 / speech-02-turbo)
// [feat: media-gen-minimax] 2026-05-28
// ============================================================
async function dispatchMinimax(entry: CatalogEntry, base: Base, input: GenInput, meta: { model: string; provider: string }): Promise<GenOutput> {
  switch (entry.capability) {
    case "image": {
      const r = await mxGenerateImage({ ...base, prompt: input.prompt ?? "", size: input.size, n: input.n })
      return { kind: "image", urls: r.urls, ...meta }
    }
    case "video": {
      // MiniMax video 用 resolution 档位(768P / 1080P);user 通过 size 字段传入(catalog params.sizes 已设此)
      const r = await mxGenerateVideo({ ...base, prompt: input.prompt ?? "", resolution: input.size, onProgress: input.onProgress })
      return { kind: "video", url: r.url, ...meta }
    }
    case "video_i2v": {
      if (!input.refFile) throw new MinimaxError("no_ref", "图生视频需要先提供一张首帧图。")
      const r = await mxGenerateVideo({ ...base, prompt: input.prompt ?? "", refImage: input.refFile, resolution: input.size, onProgress: input.onProgress })
      return { kind: "video", url: r.url, ...meta }
    }
    case "tts": {
      const r = await mxSynthesizeSpeech({ ...base, text: input.prompt ?? "", voice: input.voice })
      return { kind: "audio", url: r.url, ...meta }
    }
    // MiniMax 没的能力(image_edit / asr / translate)→ 友好报错(catalog 也没注册,理论上不会进来,留兜底)
    case "image_edit":
    case "asr":
    case "translate":
      throw new MinimaxError("not_supported", `MiniMax 暂不支持 ${entry.capability} 能力,请换 provider。`)
  }
}
