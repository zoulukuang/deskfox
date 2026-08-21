// [fork-only] REQ-102 语音派活 — Gateway 真机冒烟(不带麦克风) [feat: voice-dispatch-minimal] 2026-08-21
//
// 用**生产同款 env**(`launch-config.buildGatewayEnv`,不是手敲一串)真起一次 Gateway,验四件事:
//   ① Gateway 起得来(/api/health)且报告的 realtimeModel = 我们钉的那个
//   ② ACP 接上了,且跑的是【本仓 1.x 源码入口】(D-G)
//   ③ **飞书零影响**(T6):主实例开着的情况下,发现文件 mtime 不变、飞书进程数不变、
//      Gateway 日志里 feishu 命中 0
//   ④ 停得干净:3101 / 4396 端口不留占用
//
// 不发音频 ⇒ 不产生 DashScope 推理费用。真麦克风那轮是 T15,另跑 voice-e2e.mjs。
//
//   bun gateway-smoke.mjs [--workspace <git 仓库根>] [--keep]
import { spawn, execSync } from "node:child_process"
import { statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { GATEWAY_PORT, buildGatewayEnv, checkVoiceWorkspace } from "../../../src/main/deskfox/voice/launch-config.ts"
import { applyVoiceHarnessXdg } from "../../../src/main/deskfox/voice/launch-env.ts"
import { resolveWrapperPath } from "../../../src/main/deskfox/voice/paths.ts"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv[i + 1] : d
}
const repoRoot = path.resolve(import.meta.dir, "..", "..", "..", "..", "..")
const workspace = arg("--workspace", repoRoot)
const keep = argv.includes("--keep")

const ws = checkVoiceWorkspace(workspace)
if (!ws.ok) {
  console.error(`❌ ${ws.reason}`)
  process.exit(3)
}

const mtime = (p) => {
  try {
    return statSync(p).mtimeMs
  } catch {
    return null
  }
}
const countProc = (pattern) => {
  try {
    return execSync(`pgrep -f ${JSON.stringify(pattern)} | wc -l`, { encoding: "utf-8" }).trim()
  } catch {
    return "0"
  }
}
const portBusy = (port) => {
  try {
    execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const FEISHU_DISCOVERY = path.join(homedir(), ".opencode", "feishu-plugin-server.json")
const MEDIA_DISCOVERY = path.join(homedir(), ".opencode", "media-gen-server.json")
const before = {
  feishu: mtime(FEISHU_DISCOVERY),
  media: mtime(MEDIA_DISCOVERY),
  feishuProc: countProc("feishu"),
}

// 主进程会先设好 XDG(data-namespace);裸终端要自己补,否则验的不是上线环境
const parentEnv = applyVoiceHarnessXdg({ ...process.env })
const { env, warnings } = buildGatewayEnv({
  workspace: ws.dir,
  repoRoot,
  wrapperPath: resolveWrapperPath(repoRoot),
  env: parentEnv,
  extraPathDirs: [path.dirname(process.execPath)],
  // 默认对齐【正在跑的发布版】:共用 opencode.db。测本地版档时传 --local。
  disableChannelDb: !argv.includes("--local"),
})
for (const w of warnings) console.log(`⚠️  ${w}`)

console.log(`workspace: ${ws.dir}`)
console.log(`model:     ${JSON.parse(env.OPENCODE_CONFIG_CONTENT).model}`)
console.log(`realtime:  ${env.QWEN_AUDIO_REALTIME_MODEL}`)
console.log(`OPENCODE_BIN: ${env.OPENCODE_BIN}\n启动 Gateway…\n`)

const child = spawn("qwenaudio", ["gateway", "run", "--backend", "opencode"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
})
const logs = []
const collect = (d) => {
  const s = String(d)
  logs.push(s)
  if (process.env.VERBOSE || /acp\.|error|failed|feishu/i.test(s)) process.stdout.write(`  │ ${s.trimEnd()}\n`)
}
child.stdout.on("data", collect)
child.stderr.on("data", collect)

let health = null
const deadline = Date.now() + 120000
while (Date.now() < deadline && !health) {
  await new Promise((r) => setTimeout(r, 1500))
  try {
    const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/api/health`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) health = await res.json()
  } catch {}
}

// health ok ≠ ACP 已就绪:源码态宿主冷启动要几秒,一 ok 就停会误判成"没接上"
const acpPattern = /acp\.initialized|OpenCode\s*已连接|acp\.ready/i
if (health) {
  const acpDeadline = Date.now() + 90000
  while (Date.now() < acpDeadline && !acpPattern.test(logs.join(""))) {
    await new Promise((r) => setTimeout(r, 1000))
  }
}
const log = logs.join("")
const acpOk = acpPattern.test(log)
const listenPort = /opencode server listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(log)?.[1] ?? "?"
const feishuHits = (log.match(/feishu/gi) ?? []).length

console.log("")
const checks = [
  { ok: !!health, name: "Gateway 起来了(/api/health)", detail: health ? "" : "120s 超时" },
  {
    ok: health?.realtimeModel === env.QWEN_AUDIO_REALTIME_MODEL,
    name: "realtimeModel = 钉死的那个",
    detail: `${health?.realtimeModel ?? "?"}(期望 ${env.QWEN_AUDIO_REALTIME_MODEL})`,
  },
  { ok: health?.voiceConfigured === true, name: "voiceConfigured", detail: String(health?.voiceConfigured) },
  { ok: acpOk, name: "ACP 接上了", detail: acpOk ? "" : "日志里没看到 acp.initialized" },
  {
    ok: listenPort === "4396",
    name: "宿主 server 落在 4396(不跟主实例的 4096 撞)",
    detail: `实际 ${listenPort}`,
  },
  { ok: feishuHits === 0, name: "Gateway 日志 feishu 命中 0(T6①)", detail: `${feishuHits} 次` },
  {
    ok: mtime(FEISHU_DISCOVERY) === before.feishu,
    name: "feishu-plugin-server.json mtime 未变(T6③)",
    detail: `${before.feishu} → ${mtime(FEISHU_DISCOVERY)}`,
  },
  {
    ok: mtime(MEDIA_DISCOVERY) === before.media,
    name: "media-gen-server.json mtime 未变(子进程没抢 51737)",
    detail: `${before.media} → ${mtime(MEDIA_DISCOVERY)}`,
  },
  {
    ok: countProc("feishu") === before.feishuProc,
    name: "飞书相关进程数未变(T6②)",
    detail: `${before.feishuProc} → ${countProc("feishu")}`,
  },
]
let failed = 0
for (const c of checks) {
  if (!c.ok) failed++
  console.log(`${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`)
}

if (health) console.log(`\n/api/health 摘要:${JSON.stringify(health).slice(0, 400)}`)

if (!keep) {
  console.log("\n停 Gateway…")
  child.kill("SIGTERM")
  await new Promise((r) => setTimeout(r, 4000))
  try {
    child.kill("SIGKILL")
  } catch {}
  await new Promise((r) => setTimeout(r, 1500))
  const p3101 = portBusy(3101)
  const p4396 = portBusy(4396)
  console.log(`${!p3101 && !p4396 ? "✅" : "❌"} 端口收干净 — 3101:${p3101 ? "占用" : "空"} 4396:${p4396 ? "占用" : "空"}`)
  if (p3101 || p4396) failed++
} else {
  console.log("\n--keep:Gateway 保持运行(自己 kill)")
}
process.exit(failed ? 1 : 0)
