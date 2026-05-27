// [fork-only] 创作模式前端客户端 — 调本地生成服务(media-gen 插件的 /generate),webview 用。
// [feat: media-creation-mode] 2026-05-26
//
// 引擎要 node:fs 读 auth.json,webview 跑不了 → 由边车插件起本地 HTTP 服务(固定 loopback 端口),
// 本模块在 DeskFox 前端 fetch 它:列可用专业模型 + 触发生成(SSE 进度)。与 packages/media-gen/src/server.ts 对接。

// 用相对路径(非 @/ 别名):本文件被 packages/media-gen/scripts/probe-client.ts 跨包相对引用,
// media-gen 的 tsconfig 无 @/ 别名,用别名会让 media-gen typecheck 解析失败(TS2307)。
import { localAssetUrl } from "./local-asset"

export const MEDIA_SERVER_BASE = "http://127.0.0.1:51737"

export type MediaCapability = "image" | "image_edit" | "video" | "video_i2v" | "tts" | "asr" | "translate"

export type MediaModel = {
  id: string
  capability: MediaCapability
  provider: string
  model: string
  displayName: string
  isDefault?: boolean
  params?: { sizes?: string[]; voices?: string[]; needFile?: "image" | "audio" }
}

export type MediaResult = {
  kind: "image" | "video" | "audio" | "text"
  urls?: string[]
  url?: string
  text?: string
  localPaths?: string[] // 已落盘的本地路径(创作文件库)
  model: string
  provider: string
}

export type MediaProgress = { state: string; message?: string; percent?: number }

export type MediaGenInput = {
  prompt?: string
  size?: string
  n?: number
  voice?: string
  targetLang?: string
  refFile?: string // 参考图/首帧图(本地路径或 URL)
  audioUrl?: string // 转写音频(本地路径或 URL)
}

/** 服务是否就绪(用于创作模式入口的可用性判断) */
export async function mediaServerReady(base = MEDIA_SERVER_BASE): Promise<boolean> {
  try {
    return (await fetch(`${base}/healthz`)).ok
  } catch {
    return false
  }
}

/** 当前可用专业模型(供应商已配 key 的)— 前端据此建模式菜单 + 左侧下拉 */
export async function listMediaModels(base = MEDIA_SERVER_BASE): Promise<MediaModel[]> {
  const r = await fetch(`${base}/models`)
  if (!r.ok) throw new Error(`media server /models ${r.status}`)
  return ((await r.json()) as { entries: MediaModel[] }).entries
}

/** 触发生成。读 SSE 流:progress* → result | error。成功 resolve 结果,失败 throw(带中文文案)。 */
export async function generateMedia(
  entryId: string,
  input: MediaGenInput,
  opts?: { onProgress?: (p: MediaProgress) => void; signal?: AbortSignal; base?: string; projectDir?: string },
): Promise<MediaResult> {
  const base = opts?.base ?? MEDIA_SERVER_BASE
  const resp = await fetch(`${base}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entryId, input, projectDir: opts?.projectDir }),
    signal: opts?.signal,
  })
  if (!resp.ok || !resp.body) throw new Error(`media server /generate ${resp.status}`)

  const reader = resp.body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  let result: MediaResult | undefined
  let error: string | undefined

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const chunks = buf.split("\n\n")
    buf = chunks.pop() ?? ""
    for (const c of chunks) {
      const ev = /event: (.*)/.exec(c)?.[1]?.trim()
      const data = /data: (.*)/.exec(c)?.[1]
      if (!ev || !data) continue
      if (ev === "progress") opts?.onProgress?.(JSON.parse(data))
      else if (ev === "result") result = JSON.parse(data)
      else if (ev === "error") error = JSON.parse(data).message
    }
  }

  if (error) throw new Error(error)
  if (!result) throw new Error("生成未返回结果")
  return result
}

/**
 * 创作结果卡里媒体元素(<audio>/<video>/<img>)的 src 取值。
 * 优先用已落盘的本地文件(走 localasset:// 自定义 protocol — Rust 端给正确 MIME + HTTP Range +
 * Access-Control-Allow-Origin),而不是远端 DashScope OSS 链接:
 *   - 远端链接喂 <audio>/<video> 在 WebView 里常加载失败显示 "Error"(跨源 / 缺 Range / content-type),
 *     <img> 容忍度高才没暴露;且远端链接 24h 过期,本地文件永久可放。
 *   - 没有本地文件(理论上 kind!=text 都会落盘,这里兜底)时回落远端 url。
 * [bug-repro: 创作模式 TTS 生成完成但卡片音频播放器显示 Error(用了过期/跨源远端 url 而非本地文件)]
 */
export function creationMediaSrc(remoteUrl: string | undefined, localPath: string | undefined): string {
  if (localPath && localPath.trim()) {
    const norm = localPath.replace(/\\/g, "/")
    const i = norm.lastIndexOf("/")
    const dir = i >= 0 ? norm.slice(0, i) : norm
    return localAssetUrl(dir, norm)
  }
  return remoteUrl ?? ""
}
