// [fork-only] media-gen — 创作模式本地生成服务(前端 ↔ 引擎的通道)
// [feat: media-creation-mode] 2026-05-26
//
// 为什么要这个 server:生成引擎要读 auth.json(node:fs),DeskFox webview 跑不了 → 必须由
// 边车进程(本插件所在)起一个本地 HTTP 服务,前端 fetch 它来列模型 / 触发生成。
//
// 通道选型(P1):**固定 loopback 端口**(不写端口文件、不加 Tauri 命令、不碰 Rust)。
// 前端直接 fetch http://127.0.0.1:<PORT>;CSP 已 null,加 CORS 头即可跨源。
// (端口冲突是已知 P1 取舍;后续可换"随机端口 + 端口文件 + Tauri 命令"更稳,见需求规格。)
//
// 路由:
//   GET  /healthz   — liveness
//   GET  /models    — 当前可用专业模型清单(registry,前端建模式菜单/下拉用)
//   POST /generate  — body {entryId, input} → SSE 流(progress* → result | error)

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { DashScopeError } from "./dashscope-task"
import { runEntry } from "./dispatch"
import { availableEntries, findEntry } from "./registry"

export const MEDIA_SERVER_PORT = 51737 // 固定 loopback 端口(P1);前端按此 fetch
const PORT_FILE = join(homedir(), ".opencode", "media-gen-server.json")

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*", // 仅 loopback 可达,* 安全
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } })
}

/** 路由处理(导出供单测,不依赖真实绑定端口) */
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  const url = new URL(req.url)

  if (url.pathname === "/healthz") return json({ ok: true, service: "media-gen" })

  if (url.pathname === "/models" && req.method === "GET") {
    // 当前可用模型(供应商已配 key 的)+ 能力清单,前端据此建模式菜单 + 左侧下拉
    return json({ entries: availableEntries() })
  }

  if (url.pathname === "/generate" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { entryId?: string; input?: Record<string, unknown> }
    const entry = body.entryId ? findEntry(body.entryId) : undefined
    if (!entry) return json({ error: "model_not_found", message: "模型不存在或对应供应商未连接。" }, 404)

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder()
        const send = (event: string, data: unknown) =>
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        try {
          const out = await runEntry(entry, { ...(body.input ?? {}), onProgress: (p) => send("progress", p) })
          send("result", out)
        } catch (e) {
          const message = e instanceof DashScopeError ? e.friendly : (e as Error).message
          send("error", { message })
        } finally {
          controller.close()
        }
      },
    })
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...CORS },
    })
  }

  return json({ error: "not_found" }, 404)
}

export type MediaServerHandle = { url: string; stop: () => void }

export function startMediaServer(opts?: { port?: number }): MediaServerHandle {
  // R6:显式绑 loopback 127.0.0.1。Bun.serve 默认 hostname=0.0.0.0 会暴露到 LAN + 触发 Win
  // Firewall 弹窗。参考 feishu-server-loopback-bind feat-id(2026-05-10)。
  const server = Bun.serve({
    port: opts?.port ?? MEDIA_SERVER_PORT,
    hostname: "127.0.0.1",
    idleTimeout: 0, // 视频生成可能几分钟,关闭空闲超时,避免 SSE 流被掐
    fetch: handler,
  })
  const url = `http://127.0.0.1:${server.port}`
  try {
    const dir = join(homedir(), ".opencode")
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(PORT_FILE, JSON.stringify({ url, port: server.port }), "utf-8") // 记录用,前端用固定端口
  } catch {
    /* 端口文件写失败不影响服务 */
  }
  console.log(`[media-gen] generate server: ${url}`)
  return { url, stop: () => server.stop() }
}
