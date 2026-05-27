// [fork-only] media-gen — 多能力发现脚本:挨个实打候选模型/接口,确认有效 ID + 响应结构
// [feat: media-gen-alibaba] 2026-05-26
//
// 用法:
//   bun run packages/media-gen/scripts/probe-models.ts image   # t2i-plus + 图生图
//   bun run packages/media-gen/scripts/probe-models.ts video   # 文生视频 + 图生视频(花钱多)
// 每个测试独立 try/catch:通了打 URL,不通把阿里原始 output 打出来(好反推正确字段)。

import { ALIBABA_PROVIDER_ID, readProviderApiKey } from "../src/auth"
import { generateImage } from "../src/dashscope-image"

const BASE = "https://dashscope.aliyuncs.com"
const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
if (!apiKey) {
  console.error("✗ 没读到 alibaba-cn key")
  process.exit(1)
}
const auth = { Authorization: `Bearer ${apiKey}` }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type PollResult =
  | { ok: true; raw: any; seconds: number }
  | { ok: false; stage: string; status?: number; raw?: any; seconds: number }

async function submitPoll(
  endpoint: string,
  body: any,
  { maxWaitMs = 300_000, intervalMs = 5000 } = {},
): Promise<PollResult> {
  const t0 = Date.now()
  const sr = await fetch(BASE + endpoint, {
    method: "POST",
    headers: { ...auth, "X-DashScope-Async": "enable", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const sj = await sr.json().catch(() => ({}))
  if (!sr.ok) return { ok: false, stage: "submit", status: sr.status, raw: sj, seconds: 0 }
  const taskId = sj?.output?.task_id
  if (!taskId) return { ok: false, stage: "no_task_id", raw: sj, seconds: 0 }

  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const tr = await fetch(BASE + `/api/v1/tasks/${taskId}`, { headers: auth })
    const tj = await tr.json().catch(() => ({}))
    const st = String(tj?.output?.task_status ?? "").toUpperCase()
    process.stdout.write(`      [${st}] ${((Date.now() - t0) / 1000).toFixed(0)}s\n`)
    if (st === "SUCCEEDED") return { ok: true, raw: tj, seconds: (Date.now() - t0) / 1000 }
    if (st === "FAILED" || st === "CANCELED" || st === "CANCELLED")
      return { ok: false, stage: "task_failed", raw: tj, seconds: (Date.now() - t0) / 1000 }
  }
  return { ok: false, stage: "timeout", seconds: (Date.now() - t0) / 1000 }
}

function findUrls(obj: any): string[] {
  const out: string[] = []
  const walk = (v: any) => {
    if (!v) return
    if (typeof v === "string") {
      if (/^https?:\/\//.test(v)) out.push(v)
    } else if (Array.isArray(v)) v.forEach(walk)
    else if (typeof v === "object") Object.values(v).forEach(walk)
  }
  walk(obj)
  return [...new Set(out)]
}

async function test(name: string, fn: () => Promise<PollResult>) {
  console.log(`\n=== ${name} ===`)
  try {
    const r = await fn()
    if (r.ok) {
      console.log(`✓ OK(${r.seconds.toFixed(1)}s)`)
      for (const u of findUrls(r.raw?.output)) console.log(`   ${u}`)
    } else {
      console.log(`✗ FAIL [${r.stage}${r.status ? ` http ${r.status}` : ""}] ${r.seconds.toFixed(1)}s`)
      console.log("   raw.output:", JSON.stringify(r.raw?.output ?? r.raw)?.slice(0, 500))
    }
  } catch (e) {
    console.log("✗ ERROR", e)
  }
}

const cat = process.argv[2] ?? "image"
const PROMPT = "一只橘色的赛博朋克风格小狐狸,霓虹灯光,高细节"

if (cat === "image") {
  await test("t2i  wanx2.1-t2i-plus（高清档）", () =>
    submitPoll(
      "/api/v1/services/aigc/text2image/image-synthesis",
      { model: "wanx2.1-t2i-plus", input: { prompt: PROMPT }, parameters: { size: "1024*1024", n: 1 } },
      { intervalMs: 3000, maxWaitMs: 120_000 },
    ),
  )

  console.log("\n(图生图需要底图,先用 turbo 生一张…)")
  const base = await generateImage({ apiKey, prompt: PROMPT, model: "wanx2.1-t2i-turbo" })
  const baseUrl = base.urls[0]!
  console.log("  底图:", baseUrl)

  await test("edit wanx2.1-imageedit（description_edit 改图）", () =>
    submitPoll(
      "/api/v1/services/aigc/image2image/image-synthesis",
      {
        model: "wanx2.1-imageedit",
        input: { function: "description_edit", prompt: "把背景换成雪山", base_image_url: baseUrl },
        parameters: { n: 1 },
      },
      { intervalMs: 3000, maxWaitMs: 120_000 },
    ),
  )
}

if (cat === "video") {
  console.log("(图生视频需要底图,先用 turbo 生一张…)")
  const base = await generateImage({ apiKey, prompt: PROMPT, model: "wanx2.1-t2i-turbo" })
  const baseUrl = base.urls[0]!
  console.log("  底图:", baseUrl)

  await test("t2v  wanx2.1-t2v-turbo（文生视频）", () =>
    submitPoll(
      "/api/v1/services/aigc/video-generation/video-synthesis",
      { model: "wanx2.1-t2v-turbo", input: { prompt: PROMPT }, parameters: { size: "1280*720" } },
      { intervalMs: 8000, maxWaitMs: 360_000 },
    ),
  )

  await test("i2v  wanx2.1-i2v-turbo（图生视频）", () =>
    submitPoll(
      "/api/v1/services/aigc/video-generation/video-synthesis",
      { model: "wanx2.1-i2v-turbo", input: { prompt: PROMPT, img_url: baseUrl }, parameters: { resolution: "720P" } },
      { intervalMs: 8000, maxWaitMs: 360_000 },
    ),
  )
}
