// [fork-only] media-gen — 内环验证脚本:不开 DeskFox,直接用真 key 打 DashScope
// [feat: media-gen-alibaba] 2026-05-26
//
// 用法:
//   bun run packages/media-gen/scripts/probe.ts "一只橘色赛博朋克狐狸" [模型ID]
// 作用:第一时间确认 DashScope API + 模型 ID 是否跑通,几分钟一轮,再接 UI。
// 成功后会打印 OSS 图片链接,浏览器打开能看到图 = API 通了。

import { ALIBABA_PROVIDER_ID, authJsonPath, readProviderApiKey } from "../src/auth"
import { generateImage } from "../src/dashscope-image"

const prompt = process.argv[2] ?? "一只橘色的赛博朋克风格小狐狸头像,高细节,霓虹灯光,4k"
const model = process.argv[3] // 可选覆盖默认模型

const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
if (!apiKey) {
  console.error(`✗ 没在 ${authJsonPath()} 里找到 ${ALIBABA_PROVIDER_ID} 的 key`)
  process.exit(1)
}

console.log(`→ prompt : ${prompt}`)
console.log(`→ model  : ${model ?? "(默认)"}`)
console.log(`→ key    : ${apiKey.slice(0, 6)}…(已读到,不打印全文)`)

const t0 = Date.now()
try {
  const res = await generateImage({
    apiKey,
    prompt,
    model,
    onProgress: (p) => console.log(`   [${p.state}] ${p.message}`),
  })
  console.log(`\n✓ 成功(${((Date.now() - t0) / 1000).toFixed(1)}s),模型 ${res.model},task ${res.taskId}`)
  for (const u of res.urls) console.log(`   ${u}`)
} catch (e) {
  console.error(`\n✗ 失败:`, e)
  process.exit(1)
}
