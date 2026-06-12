// [fork-only] media-gen — 探 DashScope 本地文件上传完整链路
// [feat: media-gen-alibaba] 2026-05-26
// 流程:getPolicy → multipart 传到 OSS → oss:// 链接 → 带 X-DashScope-OssResourceResolve 头跑识别。
// 用本地临时文件冒充"用户本地文件",验证 ASR/改图/i2v 支持本地文件的可行性。

import { readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ALIBABA_PROVIDER_ID, readProviderApiKey } from "../src/auth"

const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
if (!apiKey) {
  console.error("✗ 没读到 alibaba-cn key")
  process.exit(1)
}
const auth = { Authorization: `Bearer ${apiKey}` }
const BASE = "https://dashscope.aliyuncs.com"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 1) getPolicy
console.log("→ 1. getPolicy")
const polRes = await fetch(`${BASE}/api/v1/uploads?action=getPolicy&model=paraformer-v2`, { headers: auth })
const pol = (await polRes.json())?.data
if (!pol?.upload_host) {
  console.error("✗ getPolicy 失败", JSON.stringify(pol))
  process.exit(1)
}
console.log("   host:", pol.upload_host)

// 2) 下载样例音频到本地(冒充用户本地文件)
console.log("→ 2. 下载样例音频到本地临时文件")
const sampleUrl = "https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav"
const localPath = join(tmpdir(), "media-gen-probe-sample.wav")
writeFileSync(localPath, new Uint8Array(await (await fetch(sampleUrl)).arrayBuffer()))
console.log("   local:", localPath)

// 3) multipart 上传到 OSS(file 字段必须最后)
console.log("→ 3. 上传到 OSS")
const filename = "sample.wav"
const key = `${pol.upload_dir}/${filename}`
const form = new FormData()
form.append("key", key)
form.append("policy", pol.policy)
form.append("OSSAccessKeyId", pol.oss_access_key_id)
form.append("signature", pol.signature)
form.append("x-oss-object-acl", pol.x_oss_object_acl)
form.append("x-oss-forbid-overwrite", pol.x_oss_forbid_overwrite)
form.append("success_action_status", "200")
form.append("file", new Blob([new Uint8Array(readFileSync(localPath))]), filename)
const up = await fetch(pol.upload_host, { method: "POST", body: form })
console.log("   upload status:", up.status)
if (up.status >= 300) {
  console.error("   ✗", (await up.text()).slice(0, 400))
  process.exit(1)
}
const ossUrl = `oss://${key}`
console.log("   oss url:", ossUrl)

// 4) 用 oss:// 链接跑识别(关键:带 X-DashScope-OssResourceResolve 头)
console.log("→ 4. paraformer 识别(oss:// + Resolve 头)")
const sub = await fetch(`${BASE}/api/v1/services/audio/asr/transcription`, {
  method: "POST",
  headers: {
    ...auth,
    "Content-Type": "application/json",
    "X-DashScope-Async": "enable",
    "X-DashScope-OssResourceResolve": "enable",
  },
  body: JSON.stringify({ model: "paraformer-v2", input: { file_urls: [ossUrl] }, parameters: {} }),
})
const subJson = await sub.json()
const taskId = subJson?.output?.task_id
if (!taskId) {
  console.error("   ✗ submit 失败", JSON.stringify(subJson)?.slice(0, 400))
  process.exit(1)
}
for (let i = 0; i < 40; i++) {
  await sleep(3000)
  const tj = await (await fetch(`${BASE}/api/v1/tasks/${taskId}`, { headers: auth })).json()
  const st = String(tj?.output?.task_status ?? "").toUpperCase()
  process.stdout.write(`   [${st}]\n`)
  if (st === "SUCCEEDED") {
    const turl = tj?.output?.results?.[0]?.transcription_url
    const txt = await (await fetch(turl)).json()
    console.log("\n✓ 本地文件上传 → 识别成功:", txt?.transcripts?.[0]?.text)
    process.exit(0)
  }
  if (st === "FAILED") {
    console.error("   ✗ failed", JSON.stringify(tj?.output)?.slice(0, 400))
    process.exit(1)
  }
}
console.error("✗ timeout")
process.exit(1)
