// [fork-only] 创作模式前端客户端 — 调本地生成服务(media-gen 插件的 /generate),webview 用。
// [feat: media-creation-mode] 2026-05-26
//
// 引擎要 node:fs 读 auth.json,webview 跑不了 → 由边车插件起本地 HTTP 服务(固定 loopback 端口),
// 本模块在 DeskFox 前端 fetch 它:列可用专业模型 + 触发生成(SSE 进度)。与 packages/media-gen/src/server.ts 对接。

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
  opts?: { onProgress?: (p: MediaProgress) => void; signal?: AbortSignal; base?: string },
): Promise<MediaResult> {
  const base = opts?.base ?? MEDIA_SERVER_BASE
  const resp = await fetch(`${base}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entryId, input }),
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
