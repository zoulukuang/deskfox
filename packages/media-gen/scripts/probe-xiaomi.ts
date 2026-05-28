// [fork-only] media-gen — 小米 MiMo 媒体能力探针:实打 TTS / VoiceClone / VoiceDesign / Omni-ASR 探路
// [feat: media-gen-xiaomi] 2026-05-28
//
// 用法:
//   bun run packages/media-gen/scripts/probe-xiaomi.ts tts          # MiMo-V2.5-TTS 预设音色(最快验通)
//   bun run packages/media-gen/scripts/probe-xiaomi.ts voicedesign  # 文字描述声线(messages 里塞描述)
//   bun run packages/media-gen/scripts/probe-xiaomi.ts voiceclone   # 参考音频 base64 克隆(用上一步产物)
//   bun run packages/media-gen/scripts/probe-xiaomi.ts omni-asr     # Omni 当 ASR 探路(音频 → 文字)
//   bun run packages/media-gen/scripts/probe-xiaomi.ts asr          # 直接试 mimo-v2.5-asr model id(可能 404)
//   bun run packages/media-gen/scripts/probe-xiaomi.ts all          # 串跑 tts → voicedesign → voiceclone(复用 tts 产物)
//
// 目的:① 确认 Token Plan key 在 token-plan-cn.xiaomimimo.com base 上能用
//      ② 摸清 TTS 三档协议(messages 数组 user=指令 / assistant=待合成文本 / audio={format, voice})
//      ③ Omni / ASR 是否真能转写音频(决定接不接 asr capability)
//      ④ 错误响应 schema(给 xiaomi-error.ts 设计参考)
//
// 关键事实(WebSearch 2026-05-28 整理,等 probe 真打确认):
//   - endpoint: POST {base}/v1/chat/completions(走 chat 协议而非独立 /audio/speech)
//   - auth: header "api-key: $KEY"(不是 Bearer Authorization!)
//   - base Token Plan: https://token-plan-cn.xiaomimimo.com/v1
//   - request body: { model, messages: [{role:"user",content:风格指令},{role:"assistant",content:待合成文本}], audio: {format,voice} }
//   - response: choices[0].message.audio.data 是 base64;sample_rate 24kHz pcm16 mono
//   - 3 TTS model id(小写): mimo-v2.5-tts / mimo-v2.5-tts-voicedesign / mimo-v2.5-tts-voiceclone
//   - VoiceClone 参考音频 base64 ≤10MB,mp3/wav,字段名待 probe 确认(audio.voice 还是 audio.reference_audio?)
//   - TTS 限免不消耗 Token Plan 额度

import { writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readProviderApiKey } from "../src/auth"

const XIAOMI_PROVIDER_ID = "xiaomi-token-plan-cn"
const BASE = process.env.XIAOMI_BASE || "https://token-plan-cn.xiaomimimo.com/v1"

const apiKey = readProviderApiKey(XIAOMI_PROVIDER_ID)
if (!apiKey) {
  console.error(`✗ 没读到 ${XIAOMI_PROVIDER_ID} key —— 请确认 ~/.local/share/opencode/auth.json 有此条目`)
  process.exit(1)
}
// 关键差异:不是 Bearer,是 api-key header
const headers = { "api-key": apiKey, "Content-Type": "application/json" }

function showError(j: any): string {
  // 走 OpenAI-compatible chat completions,error 形态可能是 {error: {message, code}}
  if (j?.error) return `error.code=${j.error.code} msg="${j.error.message}"`
  return ""
}

function abbreviate(v: unknown): string {
  if (v === undefined) return "(无)"
  if (typeof v !== "string") return JSON.stringify(v).slice(0, 60)
  return v.length > 60 ? `${v.slice(0, 40)}...(${v.length} chars)` : v
}

async function postChat(body: any, label: string) {
  console.log(`\n=== ${label} @ ${BASE}/chat/completions ===`)
  console.log("   model:", body.model, "| voice:", abbreviate(body.audio?.voice))
  const t0 = Date.now()
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const err = showError(j)
  console.log(`HTTP ${r.status} | ${err || "OK"} | ${secs}s`)
  return { ok: r.ok, status: r.status, json: j }
}

function extractAudio(j: any): { data?: string; format?: string } {
  // 文档说 choices[0].message.audio.data 是 base64,format 字段可能在 message.audio.format
  const msg = j?.choices?.[0]?.message
  return { data: msg?.audio?.data, format: msg?.audio?.format }
}

function saveAudio(data: string, format: string, tag: string): string {
  const ext = format === "wav" ? "wav" : format === "pcm16" ? "pcm" : "mp3"
  const path = join(tmpdir(), `xiaomi-probe-${tag}-${Date.now()}.${ext}`)
  writeFileSync(path, Buffer.from(data, "base64"))
  console.log(`   音频 → ${path} (${(data.length / 1024).toFixed(1)} KB base64)`)
  return path
}

// ============================================================
// 1) 标准 TTS:预设音色 Chloe(英文)/ 茉莉(中文备选)
// ============================================================
async function probeTts(textOverride?: string): Promise<string | undefined> {
  const text = textOverride ?? "你好,我是小米 MiMo 配音引擎,正在测试。"
  const { ok, json } = await postChat(
    {
      model: "mimo-v2.5-tts",
      messages: [
        { role: "user", content: "温暖自然的女声,语速适中。" },
        { role: "assistant", content: text },
      ],
      audio: { format: "wav", voice: "茉莉" },
    },
    "TTS 预设音色(茉莉)",
  )
  if (!ok) {
    console.log("   raw:", JSON.stringify(json).slice(0, 600))
    return
  }
  const { data, format } = extractAudio(json)
  if (!data) {
    console.log("   ✗ 响应里没找到 message.audio.data,raw:", JSON.stringify(json).slice(0, 600))
    return
  }
  return saveAudio(data, format ?? "wav", "tts")
}

// ============================================================
// 2) VoiceDesign:文字描述目标声线
// ============================================================
async function probeVoiceDesign() {
  const { ok, json } = await postChat(
    {
      model: "mimo-v2.5-tts-voicedesign",
      messages: [
        { role: "user", content: "一个中年男性,声音沉稳有磁性,像新闻主播播报感。" },
        { role: "assistant", content: "新闻联播,今天的主要内容有:小米 MiMo 全模态模型今日开放测试。" },
      ],
      // 2026-05-28 probe 实测确认:VoiceDesign 不支持 audio.voice 字段(报 "audio.voice is not supported for voice design model")
      // 声线完全由 user message 的描述生成,audio 只填 format
      audio: { format: "wav" },
    },
    "VoiceDesign 文字描述声线",
  )
  if (!ok) {
    console.log("   raw:", JSON.stringify(json).slice(0, 600))
    return
  }
  const { data, format } = extractAudio(json)
  if (!data) {
    console.log("   ✗ raw:", JSON.stringify(json).slice(0, 600))
    return
  }
  saveAudio(data, format ?? "wav", "voicedesign")
}

// ============================================================
// 3) VoiceClone:参考音频 base64 克隆
// 参考音频:优先用上一步 TTS 产物;没有的话兜底从环境变量 XIAOMI_REF_AUDIO 读
// ============================================================
async function probeVoiceClone(refAudioPath?: string) {
  const ref = refAudioPath ?? process.env.XIAOMI_REF_AUDIO
  if (!ref || !existsSync(ref)) {
    console.log(
      "\n=== VoiceClone === (跳过 — 没有参考音频。先跑 'all' 或 'tts' 生成产物,或设 XIAOMI_REF_AUDIO env)",
    )
    return
  }
  const audioBytes = readFileSync(ref)
  const audioB64 = audioBytes.toString("base64")
  const mime = ref.endsWith(".wav") ? "audio/wav" : ref.endsWith(".mp3") ? "audio/mpeg" : "audio/wav"
  const dataUrl = `data:${mime};base64,${audioB64}`
  console.log(`   参考音频:${ref}(${(audioBytes.length / 1024).toFixed(1)} KB → DataURL ${(dataUrl.length / 1024).toFixed(1)} KB)`)

  // 2026-05-28 probe 实测确认:audio.voice 必须是 DataURL 格式("data:audio/wav;base64,xxx")
  // 报错原文:"audio.voice must be a DataURL for voice clone model"
  const { ok, json } = await postChat(
    {
      model: "mimo-v2.5-tts-voiceclone",
      messages: [
        { role: "user", content: "" },
        { role: "assistant", content: "这段话用你刚才听到的声音说出来,确认克隆是否生效。" },
      ],
      audio: { format: "wav", voice: dataUrl },
    },
    "VoiceClone(audio.voice=DataURL)",
  )
  if (!ok) {
    console.log("   raw:", JSON.stringify(json).slice(0, 600))
    return
  }
  const { data, format } = extractAudio(json)
  if (!data) {
    console.log("   ✗ raw:", JSON.stringify(json).slice(0, 600))
    return
  }
  saveAudio(data, format ?? "wav", "voiceclone")
}

// ============================================================
// 4) Omni 当 ASR 探路:输入音频 → 输出文字
// ============================================================
async function probeOmniAsr(audioPath?: string) {
  const audio = audioPath ?? process.env.XIAOMI_REF_AUDIO
  if (!audio || !existsSync(audio)) {
    console.log("\n=== Omni-ASR === (跳过 — 没有音频文件。先跑 tts 产生,或设 XIAOMI_REF_AUDIO env)")
    return
  }
  const audioB64 = readFileSync(audio).toString("base64")
  const fmt = audio.endsWith(".wav") ? "wav" : audio.endsWith(".mp3") ? "mp3" : "wav"

  // 多模态消息:user content 数组里塞 input_audio
  const { ok, json } = await postChat(
    {
      model: "mimo-v2.5",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "请把这段音频内容逐字转成文字,只输出文字本身,不要任何额外解释。" },
            { type: "input_audio", input_audio: { data: audioB64, format: fmt } },
          ],
        },
      ],
    },
    "Omni 当 ASR(mimo-v2.5 多模态)",
  )
  if (!ok) {
    console.log("   raw:", JSON.stringify(json).slice(0, 800))
    return
  }
  const text = json?.choices?.[0]?.message?.content
  if (text) console.log(`   转写结果:${typeof text === "string" ? text.slice(0, 300) : JSON.stringify(text).slice(0, 300)}`)
  else console.log("   ✗ 没拿到 message.content,raw:", JSON.stringify(json).slice(0, 600))
}

// ============================================================
// 5) 直接试 mimo-v2.5-asr model id(model list 没列,可能 404 / 也可能藏着)
// ============================================================
async function probeAsrDirect(audioPath?: string) {
  const audio = audioPath ?? process.env.XIAOMI_REF_AUDIO
  if (!audio || !existsSync(audio)) {
    console.log("\n=== ASR 直接试 === (跳过 — 需要 XIAOMI_REF_AUDIO env 或先跑 tts)")
    return
  }
  const audioB64 = readFileSync(audio).toString("base64")
  const fmt = audio.endsWith(".wav") ? "wav" : audio.endsWith(".mp3") ? "mp3" : "wav"
  const { ok, json } = await postChat(
    {
      model: "mimo-v2.5-asr",
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: audioB64, format: fmt } }],
        },
      ],
    },
    "ASR 直接 model id(mimo-v2.5-asr)",
  )
  if (!ok) {
    console.log("   raw:", JSON.stringify(json).slice(0, 600))
    return
  }
  console.log("   raw:", JSON.stringify(json).slice(0, 600))
}

// ============================================================
// 主入口
// ============================================================
const cat = process.argv[2] ?? "tts"
if (cat === "tts") await probeTts()
else if (cat === "voicedesign") await probeVoiceDesign()
else if (cat === "voiceclone") await probeVoiceClone()
else if (cat === "omni-asr") await probeOmniAsr()
else if (cat === "asr") await probeAsrDirect()
else if (cat === "all") {
  const ttsPath = await probeTts()
  await probeVoiceDesign()
  await probeVoiceClone(ttsPath)
  await probeOmniAsr(ttsPath)
  await probeAsrDirect(ttsPath)
} else {
  console.error("未知能力,用 tts | voicedesign | voiceclone | omni-asr | asr | all")
  process.exit(1)
}
