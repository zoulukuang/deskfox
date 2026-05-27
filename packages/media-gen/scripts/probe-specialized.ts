// [fork-only] media-gen — 专业模型发现脚本:翻译 / 语音合成 / 语音识别
// [feat: media-gen-alibaba] 2026-05-26
//
// 用法:bun run packages/media-gen/scripts/probe-specialized.ts
// 这三类协议各不相同(翻译=同步 chat / TTS=多模态生成 / ASR=异步任务),
// 故本脚本目的是"摸清各自协议形态 + 有效 ID",不通就把原始报错打出来反推。

import { ALIBABA_PROVIDER_ID, readProviderApiKey } from "../src/auth"

const apiKey = readProviderApiKey(ALIBABA_PROVIDER_ID)
if (!apiKey) {
  console.error("✗ 没读到 alibaba-cn key")
  process.exit(1)
}
const auth = { Authorization: `Bearer ${apiKey}` }
const BASE = "https://dashscope.aliyuncs.com"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function postJson(url: string, body: any, extraHeaders: Record<string, string> = {}) {
  const r = await fetch(url, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, ok: r.ok, json: j }
}

// ---- 1. 翻译:qwen-mt(OpenAI 兼容 chat,同步) ----
async function testTranslate() {
  console.log("\n=== 翻译 qwen-mt-turbo（同步 chat） ===")
  const r = await postJson(`${BASE}/compatible-mode/v1/chat/completions`, {
    model: "qwen-mt-turbo",
    messages: [{ role: "user", content: "今天天气很好,我们一起去公园散步吧。" }],
    translation_options: { source_lang: "Chinese", target_lang: "English" },
  })
  if (r.ok) console.log("✓ 译文:", r.json?.choices?.[0]?.message?.content)
  else console.log("✗ FAIL", r.status, JSON.stringify(r.json)?.slice(0, 400))
}

// ---- 2. 语音合成:qwen-tts(多模态生成端点,试同步) ----
async function testTts() {
  console.log("\n=== 语音合成 qwen-tts（多模态生成端点） ===")
  const r = await postJson(`${BASE}/api/v1/services/aigc/multimodal-generation/generation`, {
    model: "qwen-tts",
    input: { text: "你好,我是小狐狸,很高兴认识你。", voice: "Cherry" },
  })
  if (r.ok) console.log("✓ output:", JSON.stringify(r.json?.output)?.slice(0, 500))
  else console.log("✗ FAIL", r.status, JSON.stringify(r.json)?.slice(0, 500))
}

// ---- 3. 语音识别:paraformer-v2(异步任务,用阿里公开样例音频) ----
async function testAsr() {
  console.log("\n=== 语音识别 paraformer-v2（异步任务 + 公开样例音频） ===")
  const SAMPLE = "https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav"
  const sub = await postJson(
    `${BASE}/api/v1/services/audio/asr/transcription`,
    { model: "paraformer-v2", input: { file_urls: [SAMPLE] }, parameters: {} },
    { "X-DashScope-Async": "enable" },
  )
  if (!sub.ok) {
    console.log("✗ submit FAIL", sub.status, JSON.stringify(sub.json)?.slice(0, 400))
    return
  }
  const taskId = sub.json?.output?.task_id
  console.log("  task:", taskId)
  for (let i = 0; i < 40; i++) {
    await sleep(3000)
    const t = await fetch(`${BASE}/api/v1/tasks/${taskId}`, { headers: auth })
    const tj = await t.json().catch(() => ({}))
    const st = String(tj?.output?.task_status ?? "").toUpperCase()
    process.stdout.write(`   [${st}]\n`)
    if (st === "SUCCEEDED") {
      const out = tj?.output
      console.log("  output:", JSON.stringify(out)?.slice(0, 500))
      // 转写结果是个 JSON 文件 URL,拉下来看实际文字
      const turl = out?.results?.[0]?.transcription_url
      if (turl) {
        const txt = await (await fetch(turl)).json().catch(() => null)
        const sentences = txt?.transcripts?.[0]?.text ?? JSON.stringify(txt)?.slice(0, 300)
        console.log("✓ 识别文字:", sentences)
      }
      return
    }
    if (st === "FAILED") {
      console.log("✗ failed", JSON.stringify(tj?.output)?.slice(0, 400))
      return
    }
  }
  console.log("✗ timeout")
}

await testTranslate()
await testTts()
await testAsr()
