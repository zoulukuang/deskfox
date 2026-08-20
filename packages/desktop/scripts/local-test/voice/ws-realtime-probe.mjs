// [fork-only] REQ-102 语音派活 — DashScope realtime 模型可用性/能力探针 [feat: voice-dispatch-minimal] 2026-08-21
//
// 干什么:拿 DeskFox 自己配的 alibaba-cn key,对 1.11.0 catalog 里的四个 realtime 档案各开一条
// WebSocket,看能不能拿到 `session.created`,并把服务端回报的 session 配置(音色 / 转向检测 /
// modalities)打出来。**不发音频、不产生推理费用** —— 建连即断,只验权限与默认档位。
//
// 为什么需要:D-F 的前端选型要在 audio-3.0-plus(smart_turn)与 qwen3.5-omni-plus(semantic_vad)
// 之间定终选,而"服务端实际给的默认转向检测是什么"只能问服务端,不能照文档猜。
//
// 跑法(必须用 bun:要 import TS + 要 WebSocket 自定义 header):
//   bun packages/desktop/scripts/local-test/voice/ws-realtime-probe.mjs
import {
  applyVoiceHarnessXdg,
  DASHSCOPE_PROVIDER_ID,
  KNOWN_REALTIME_MODELS,
  readProviderApiKey,
  resolveAuthJsonPath,
} from "../../../src/main/deskfox/voice/launch-env.ts"

const REALTIME_BASE = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
const TIMEOUT_MS = 15000

// 裸终端没有主进程设的 XDG,不补就会读到【旧命名空间】那份 auth.json —— 验的不是上线环境。
const env = applyVoiceHarnessXdg()
const authPath = resolveAuthJsonPath(env)
const key = readProviderApiKey(DASHSCOPE_PROVIDER_ID, authPath)
if (!key) {
  console.error(`❌ 没读到 ${DASHSCOPE_PROVIDER_ID} 的 API key(${authPath})`)
  console.error("   先在 DeskFox 设置里连接阿里供应商;注意 auth.json 路径随 XDG_DATA_HOME 走。")
  process.exit(3)
}
console.log(`key 源:${authPath}(${DASHSCOPE_PROVIDER_ID},sk-***${key.slice(-4)})\n`)

/** 开一条 WS,等 session.created;超时/错误都算失败,不抛。 */
function probe(model) {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const done = (r) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {}
      resolve({ model, elapsedMs: Date.now() - started, ...r })
    }
    const timer = setTimeout(() => done({ ok: false, note: `超时 ${TIMEOUT_MS}ms 未收到 session.created` }), TIMEOUT_MS)

    let ws
    try {
      ws = new WebSocket(`${REALTIME_BASE}?model=${encodeURIComponent(model)}`, {
        headers: { Authorization: `Bearer ${key}`, "OpenAI-Beta": "realtime=v1" },
      })
    } catch (e) {
      done({ ok: false, note: `建连抛错:${e?.message ?? e}` })
      return
    }

    ws.addEventListener("error", () => done({ ok: false, note: "WebSocket error(多为鉴权失败或模型无权限)" }))
    ws.addEventListener("close", (e) => done({ ok: false, note: `连接被关闭 code=${e.code} ${e.reason || ""}`.trim() }))
    ws.addEventListener("message", (e) => {
      let evt
      try {
        evt = JSON.parse(String(e.data))
      } catch {
        return
      }
      if (evt.type === "session.created") {
        const s = evt.session ?? {}
        done({
          ok: true,
          voice: s.voice ?? null,
          modalities: Array.isArray(s.modalities) ? s.modalities.join(",") : (s.output_modalities?.join(",") ?? null),
          turnDetection: s.turn_detection?.type ?? (s.turn_detection === null ? "null(手动)" : null),
          inputFormat: s.input_audio_format ?? null,
        })
      } else if (evt.type === "error") {
        done({ ok: false, note: `服务端 error:${evt.error?.message ?? JSON.stringify(evt.error ?? evt)}` })
      }
    })
  })
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : KNOWN_REALTIME_MODELS
const results = []
for (const m of targets) {
  process.stdout.write(`探测 ${m} … `)
  const r = await probe(m)
  console.log(r.ok ? `✅ ${r.elapsedMs}ms` : `❌ ${r.note}`)
  results.push(r)
}

console.log("\n| 模型 | 建连 | 默认音色 | 转向检测 | modalities | 输入格式 |")
console.log("|---|---|---|---|---|---|")
for (const r of results) {
  console.log(
    `| \`${r.model}\` | ${r.ok ? "✅" : "❌"} | ${r.voice ?? "—"} | ${r.turnDetection ?? "—"} | ${r.modalities ?? "—"} | ${r.inputFormat ?? "—"} |`,
  )
}
const failed = results.filter((r) => !r.ok)
if (failed.length) {
  console.log(`\n失败 ${failed.length}/${results.length}:`)
  for (const r of failed) console.log(`  - ${r.model}: ${r.note}`)
}
process.exit(failed.length === results.length ? 1 : 0)
