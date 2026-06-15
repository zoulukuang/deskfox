// [fork-only] media-gen — 实跑本地生成服务,验证整条后端通道(列模型 + SSE 生成)
// [feat: media-creation-mode] 2026-05-26
// 用法:bun run packages/media-gen/scripts/probe-server.ts

import { startMediaServer } from "../src/server"

const handle = await startMediaServer({ port: 51738 }) // 测试端口,避开默认 51737
const base = handle.url

console.log("→ GET /healthz")
console.log("  ", await (await fetch(`${base}/healthz`)).json())

console.log("→ GET /models")
const models = (await (await fetch(`${base}/models`)).json()) as { entries: { id: string; displayName: string }[] }
console.log(`  可用 ${models.entries.length} 个:`, models.entries.map((e) => e.id).join(", "))

console.log("→ POST /generate(文生图,SSE)")
const resp = await fetch(`${base}/generate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ entryId: "alibaba-wanx2.1-t2i-turbo", input: { prompt: "一只橘色的小狐狸,纯白背景" } }),
})
const reader = resp.body!.getReader()
const dec = new TextDecoder()
let buf = ""
while (true) {
  const { value, done } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  const chunks = buf.split("\n\n")
  buf = chunks.pop() ?? ""
  for (const c of chunks) {
    const ev = c.match(/event: (.*)/)?.[1]
    const data = c.match(/data: (.*)/)?.[1]
    if (ev === "progress") console.log("   [progress]", JSON.parse(data!).message ?? JSON.parse(data!).state)
    else if (ev === "result") {
      const r = JSON.parse(data!)
      console.log(`\n✓ result: kind=${r.kind} model=${r.model}`)
      console.log("   url:", r.urls?.[0] ?? r.url ?? r.text)
      console.log("   localPaths:", r.localPaths)
    } else if (ev === "error") console.log("\n✗ error:", JSON.parse(data!).message)
  }
}

console.log("→ GET /files(创作文件库)")
const files = (await (await fetch(`${base}/files`)).json()) as { images: unknown[]; videos: unknown[]; audio: unknown[] }
console.log(`  images=${files.images.length} videos=${files.videos.length} audio=${files.audio.length}`)

handle.stop()
process.exit(0)
