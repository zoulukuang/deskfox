// FORK-ONLY: Bun.serve → Node http 适配 [feat: electron-replatform] 2026-06-12
//
// Electron 边车跑 Node(不再是 Bun),Bun.serve 在 Node 下抛 "Bun is not defined"。
// 本 shim 用 node:http 实现 Bun.serve 的子集({ port, hostname, fetch }):node IncomingMessage
// ↔ Web Request/Response 互转,支持 SSE 流式响应(/generate)。
// 孪生文件:packages/adapter-feishu-lark/src/node-serve.ts(同一 shim,两 fork 包独立打包故各存一份)。

import http from "node:http"

export type ServeFetchOptions = {
  port?: number
  hostname?: string
  fetch: (req: Request) => Promise<Response> | Response
}
export type ServeFetchHandle = { port: number; stop: () => void }

export function serveFetch(opts: ServeFetchOptions): Promise<ServeFetchHandle> {
  const hostname = opts.hostname ?? "127.0.0.1"
  const server = http.createServer((nodeReq, nodeRes) => {
    handle(opts.fetch, hostname, nodeReq, nodeRes).catch((e) => {
      try {
        if (!nodeRes.headersSent) nodeRes.statusCode = 500
        nodeRes.end(String((e as Error)?.message ?? e))
      } catch {
        /* 连接已断 */
      }
    })
  })
  // SSE / 长生成(视频可能几分钟)— 关闭 socket / 请求超时,避免流被掐(对齐 Bun idleTimeout:0)
  server.timeout = 0
  server.requestTimeout = 0
  server.headersTimeout = 0
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => reject(e)
    server.once("error", onError)
    server.listen(opts.port ?? 0, hostname, () => {
      server.removeListener("error", onError)
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? 0)
      resolve({ port, stop: () => server.close() })
    })
  })
}

async function handle(
  fetchFn: ServeFetchOptions["fetch"],
  hostname: string,
  nodeReq: http.IncomingMessage,
  nodeRes: http.ServerResponse,
): Promise<void> {
  const method = (nodeReq.method ?? "GET").toUpperCase()
  const host = nodeReq.headers.host ?? hostname
  const url = `http://${host}${nodeReq.url ?? "/"}`

  const headers = new Headers()
  for (const [k, v] of Object.entries(nodeReq.headers)) {
    if (v === undefined) continue
    if (Array.isArray(v)) for (const vv of v) headers.append(k, vv)
    else headers.set(k, v)
  }

  let body: Buffer | undefined
  if (method !== "GET" && method !== "HEAD") body = await readBody(nodeReq)

  const reqBody = body && body.length ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : undefined
  const req = new Request(url, { method, headers, body: reqBody as BodyInit | undefined })
  const res = await fetchFn(req)

  nodeRes.statusCode = res.status
  res.headers.forEach((value, key) => nodeRes.setHeader(key, value))

  if (!res.body) {
    nodeRes.end(Buffer.from(await res.arrayBuffer()))
    return
  }
  // 流式(SSE):逐块写,不设 content-length → chunked,实时 flush
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) nodeRes.write(Buffer.from(value))
    }
  } finally {
    nodeRes.end()
  }
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c as Buffer))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}
