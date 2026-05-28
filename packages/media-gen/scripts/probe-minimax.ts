// [fork-only] media-gen — minimax 媒体能力探针:实打 image / video / tts,确认余额 + 摸清协议
// [feat: media-gen-minimax] 2026-05-27
//
// 用法:
//   bun run packages/media-gen/scripts/probe-minimax.ts image   # 文生图(最便宜,先验余额)
//   bun run packages/media-gen/scripts/probe-minimax.ts video   # 海螺视频(贵,submit→poll→retrieve 三步)
//   bun run packages/media-gen/scripts/probe-minimax.ts tts      # 语音合成(hex 内联音频)
//
// 目的:① 确认之前的 1008 insufficient_balance 没了 ② 摸清 minimax 三种协议形态(给抽象通用层做素材)。
// minimax 错误码:base_resp.status_code,0=成功,1008=余额不足,1004=鉴权失败。

import { readProviderApiKey } from "../src/auth"

// 对齐 opencode 上游 minimax 官方 auth id(2026-05-28 实测 user 重 auth 后用此 id)
const MINIMAX_PROVIDER_ID = "minimax-cn-coding-plan"
// minimax 媒体 API 标准 host(国内统一到 minimaxi.com;若鉴权失败再试 api.minimax.chat)
const BASE = process.env.MINIMAX_BASE || "https://api.minimaxi.com"

const apiKey = readProviderApiKey(MINIMAX_PROVIDER_ID)
if (!apiKey) {
  console.error("✗ 没读到 minimax-cn-coding-plan key")
  process.exit(1)
}
const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function showBaseResp(j: any): string {
  const b = j?.base_resp
  if (!b) return "(无 base_resp)"
  return `status_code=${b.status_code} msg="${b.status_msg}"`
}

async function probeImage() {
  console.log(`\n=== 文生图 image-01 @ ${BASE} ===`)
  const t0 = Date.now()
  const r = await fetch(`${BASE}/v1/image_generation`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "image-01",
      prompt: "一只橘色的赛博朋克风格小狐狸,霓虹灯光,高细节",
      aspect_ratio: "1:1",
      response_format: "url",
      n: 1,
      prompt_optimizer: true,
    }),
  })
  const j = await r.json().catch(() => ({}))
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`HTTP ${r.status} | ${showBaseResp(j)} | ${secs}s`)
  const urls: string[] = j?.data?.image_urls ?? []
  if (urls.length) urls.forEach((u) => console.log("   图:", u))
  else console.log("   raw:", JSON.stringify(j).slice(0, 600))
}

async function probeVideo() {
  console.log(`\n=== 海螺视频 MiniMax-Hailuo-02 @ ${BASE}(submit→poll→retrieve)===`)
  const t0 = Date.now()
  // 1) 提交
  const sr = await fetch(`${BASE}/v1/video_generation`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "MiniMax-Hailuo-2.3",
      prompt: "一只橘色小狐狸在霓虹城市里奔跑,赛博朋克",
      duration: 6,
      resolution: "768P",
    }),
  })
  const sj = await sr.json().catch(() => ({}))
  console.log(`submit HTTP ${sr.status} | ${showBaseResp(sj)}`)
  const taskId = sj?.task_id
  if (!taskId) {
    console.log("   无 task_id,raw:", JSON.stringify(sj).slice(0, 600))
    return
  }
  console.log("   task_id:", taskId)
  // 2) 轮询
  let fileId = ""
  const deadline = Date.now() + 360_000
  while (Date.now() < deadline) {
    await sleep(8000)
    const qr = await fetch(`${BASE}/v1/query/video_generation?task_id=${taskId}`, { headers })
    const qj = await qr.json().catch(() => ({}))
    const st = qj?.status
    process.stdout.write(`      [${st}] ${((Date.now() - t0) / 1000).toFixed(0)}s\n`)
    if (st === "Success") {
      fileId = qj?.file_id
      break
    }
    if (st === "Fail") {
      console.log("   失败 raw:", JSON.stringify(qj).slice(0, 600))
      return
    }
  }
  if (!fileId) {
    console.log("   超时未拿到 file_id")
    return
  }
  // 3) 取文件下载地址
  const fr = await fetch(`${BASE}/v1/files/retrieve?file_id=${fileId}`, { headers })
  const fj = await fr.json().catch(() => ({}))
  const url = fj?.file?.download_url
  console.log(`retrieve HTTP ${fr.status} | ${showBaseResp(fj)}`)
  console.log(url ? `   视频: ${url}` : `   raw: ${JSON.stringify(fj).slice(0, 600)}`)
}

async function probeTts() {
  console.log(`\n=== 语音合成 t2a_v2 @ ${BASE}(无 GroupId 试)===`)
  const t0 = Date.now()
  const r = await fetch(`${BASE}/v1/t2a_v2`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "speech-2.8-turbo",
      text: "你好,我是小狐狸,很高兴为你服务。",
      stream: false,
      voice_setting: { voice_id: "male-qn-qingse", speed: 1.0, vol: 1.0, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3" },
    }),
  })
  const j = await r.json().catch(() => ({}))
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`HTTP ${r.status} | ${showBaseResp(j)} | ${secs}s`)
  const audioHex: string | undefined = j?.data?.audio
  if (audioHex) console.log(`   音频(hex 内联),长度=${audioHex.length} 字符 ≈ ${(audioHex.length / 2 / 1024).toFixed(1)}KB`)
  else console.log("   raw:", JSON.stringify(j).slice(0, 600))
}

const cat = process.argv[2] ?? "image"
if (cat === "image") await probeImage()
else if (cat === "video") await probeVideo()
else if (cat === "tts") await probeTts()
else console.error("未知能力,用 image / video / tts")
