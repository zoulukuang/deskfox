// [fork-only] media-gen — 验证前端客户端 ↔ 本地服务 端到端契约
// [feat: media-creation-mode] 2026-05-26
// 起服务 → 用前端客户端(packages/app 的 media-creation)列模型 + 跑一次翻译(便宜验 SSE 解析)

import { generateMedia, listMediaModels, mediaServerReady } from "../../app/src/utils/media-creation"
import { startMediaServer } from "../src/server"

const base = "http://127.0.0.1:51739"
const handle = await startMediaServer({ port: 51739 })

console.log("ready:", await mediaServerReady(base))

const models = await listMediaModels(base)
console.log(`models: ${models.length} 个 →`, models.map((m) => `${m.capability}:${m.id}`).join(" "))

console.log("→ 翻译(验客户端 SSE 解析)")
const out = await generateMedia(
  "alibaba-qwen-mt-turbo",
  { prompt: "今天天气真好,一起去公园散步吧", targetLang: "English" },
  { base, onProgress: (p) => console.log("   [progress]", p.message ?? p.state) },
)
console.log(`✓ ${out.kind}:`, out.text ?? out.url ?? out.urls?.[0])

handle.stop()
process.exit(0)
