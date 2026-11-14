// [fork-only] REQ-102 语音派活 — Gateway WS 客户端(测试装置共用) [feat: voice-dispatch-minimal] 2026-08-21
//
// 协议来源(qwen-audio-agent 1.11.0,别照 1.7.0 的记忆写):
//   `shared/realtime-events.mjs` — GatewayClientEvent / GatewayServerEvent 全集
//   `tui/src/index.mjs:1181`     — 参考客户端:{type:'audio.append', audio:<base64>}
// 采样率 16kHz / PCM16 单声道(Gateway `/api/health` 的 realtimeInputSampleRate)。
import { readFileSync } from "node:fs"

export const DEFAULT_GATEWAY = "ws://127.0.0.1:3101/api/realtime"
export const SAMPLE_RATE = 16000
export const BYTES_PER_SAMPLE = 2
/** 每片 100ms —— 与真实麦克风采集节奏同量级;太大就不是"实时灌"了,VAD 行为会失真。 */
export const CHUNK_MS = 100

const BYTES_PER_CHUNK = (SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_MS) / 1000

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class GatewayClient {
  constructor(url = DEFAULT_GATEWAY, { verbose = true } = {}) {
    this.url = url
    this.verbose = verbose
    this.events = []
    this.t0 = Date.now()
    this.ws = null
    this._waiters = []
  }

  get elapsed() {
    return Date.now() - this.t0
  }

  async connect(timeoutMs = 10000) {
    this.ws = new WebSocket(this.url)
    this.ws.addEventListener("message", (e) => this._onMessage(e))
    this.ws.addEventListener("close", (e) => this._record({ type: "__closed", code: e.code, reason: e.reason }))
    this.ws.addEventListener("error", () => this._record({ type: "__error" }))
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`连不上 Gateway(${this.url});先 \`qwenaudio gateway status\` 看它起没起`)),
        timeoutMs,
      )
      this.ws.addEventListener("open", () => {
        clearTimeout(timer)
        resolve()
      })
      this.ws.addEventListener("error", () => {
        clearTimeout(timer)
        reject(new Error(`连不上 Gateway(${this.url})`))
      })
    })
    this.t0 = Date.now()
  }

  _onMessage(e) {
    let evt
    try {
      evt = JSON.parse(String(e.data))
    } catch {
      return
    }
    this._record(evt)
  }

  _record(evt) {
    const at = this.elapsed
    this.events.push({ at, evt })
    // audio.delta 是逐帧音频,刷屏且无信息量 —— 只计数不打印
    if (this.verbose && evt.type !== "audio.delta") {
      console.log(`  [${String(at).padStart(6)}ms] ${evt.type}${summarize(evt)}`)
    }
    for (const w of this._waiters.slice()) {
      if (w.match(evt)) {
        this._waiters.splice(this._waiters.indexOf(w), 1)
        w.resolve({ at, evt })
      }
    }
  }

  /** 等一个满足条件的事件;超时返回 null(由调用方决定算不算失败)。 */
  waitFor(match, timeoutMs = 60000) {
    const hit = this.events.find((e) => match(e.evt))
    if (hit) return Promise.resolve(hit)
    return new Promise((resolve) => {
      const w = { match, resolve }
      this._waiters.push(w)
      setTimeout(() => {
        const i = this._waiters.indexOf(w)
        if (i >= 0) {
          this._waiters.splice(i, 1)
          resolve(null)
        }
      }, timeoutMs)
    })
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj))
  }

  /** 按【真实时速率】灌一段 PCM —— 快灌会让服务端 VAD 判定失真,验出来的不作数。 */
  async feedPcm(pcmPath, { label = "" } = {}) {
    const buf = readFileSync(pcmPath)
    const chunks = Math.ceil(buf.length / BYTES_PER_CHUNK)
    if (this.verbose) {
      console.log(`  ▶ 灌音频 ${label || pcmPath}(${Math.round((buf.length / 32000) * 1000)}ms,${chunks} 片)`)
    }
    for (let i = 0; i < chunks; i++) {
      const slice = buf.subarray(i * BYTES_PER_CHUNK, (i + 1) * BYTES_PER_CHUNK)
      this.send({ type: "audio.append", audio: slice.toString("base64") })
      await sleep(CHUNK_MS)
    }
  }

  interrupt() {
    this.send({ type: "interrupt" })
  }

  count(type) {
    return this.events.filter((e) => e.evt.type === type).length
  }

  find(type) {
    return this.events.find((e) => e.evt.type === type) ?? null
  }

  all(type) {
    return this.events.filter((e) => e.evt.type === type)
  }

  close() {
    try {
      this.ws?.close()
    } catch {}
  }
}

function summarize(evt) {
  const bits = []
  if (evt.taskId) bits.push(`task=${String(evt.taskId).slice(0, 20)}`)
  if (evt.origin) bits.push(`origin=${evt.origin}`)
  if (evt.text) bits.push(`text=${JSON.stringify(String(evt.text).slice(0, 60))}`)
  if (evt.transcript) bits.push(`transcript=${JSON.stringify(String(evt.transcript).slice(0, 60))}`)
  if (evt.objective) bits.push(`objective=${JSON.stringify(String(evt.objective).slice(0, 60))}`)
  if (evt.result) bits.push(`result=${JSON.stringify(String(evt.result).slice(0, 80))}`)
  if (evt.error) bits.push(`error=${JSON.stringify(evt.error)}`)
  return bits.length ? ` ${bits.join(" ")}` : ""
}

/** 统一的收尾:打印判定表,返回 exit code。 */
export function report(title, checks) {
  console.log(`\n=== ${title} ===`)
  let failed = 0
  for (const c of checks) {
    if (!c.ok) failed++
    console.log(`${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`)
  }
  console.log(failed ? `\n${failed}/${checks.length} 项未过` : `\n全部 ${checks.length} 项通过`)
  return failed ? 1 : 0
}
