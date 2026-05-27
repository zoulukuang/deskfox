// [fork-only] media-gen — 探更强的指令编辑模型 qwen-image-edit(对比 wanx2.1-imageedit)
// [feat: media-gen-alibaba] 2026-05-26
// 用法:bun run packages/media-gen/scripts/probe-qwen-edit.ts [model]

import { writeFileSync } from "node:fs"
import { ALIBABA_PROVIDER_ID, readProviderApiKey } from "../src/auth"
import { generateImage } from "../src/dashscope-image"

const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
if (!apiKey) {
  console.error("✗ 没读到 key")
  process.exit(1)
}
const BASE = "https://dashscope.aliyuncs.com"
const model = process.argv[2] ?? "qwen-image-edit"

console.log("→ 生成底图(橘狐狸 白背景)")
const base = await generateImage({ apiKey, prompt: "一只橘色的小狐狸,纯白色背景,卡通插画", model: "wanx2.1-t2i-turbo" })
const foxUrl = base.urls[0]!
console.log("   底图:", foxUrl)

console.log(`→ 用 ${model} 改背景(multimodal-generation,messages 格式)`)
const body = {
  model,
  input: { messages: [{ role: "user", content: [{ image: foxUrl }, { text: "把背景换成纯绿色,狐狸保持不变" }] }] },
  parameters: {},
}
const r = await fetch(`${BASE}/api/v1/services/aigc/multimodal-generation/generation`, {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
})
console.log("   status:", r.status)
const j = await r.json().catch(() => ({}))
console.log("   raw:", JSON.stringify(j).slice(0, 900))

// 找 response 里的图片 url
const urls: string[] = []
const walk = (v: any) => {
  if (!v) return
  if (typeof v === "string" && /^https?:\/\//.test(v)) urls.push(v)
  else if (Array.isArray(v)) v.forEach(walk)
  else if (typeof v === "object") Object.values(v).forEach(walk)
}
walk(j?.output)
if (urls.length) {
  console.log("\n✓ 拿到图片 url:", urls[0])
  writeFileSync("D:/tmp/windows-temp/qwen-edit-after.png", new Uint8Array(await (await fetch(urls[0]!)).arrayBuffer()))
  console.log("   已存 D:/tmp/windows-temp/qwen-edit-after.png")
} else {
  console.log("\n✗ 没在响应里找到图片 url(可能模型不可用或协议不同,看上面 raw)")
}
