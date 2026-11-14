// [fork-only] REQ-102 语音派活 — ACP 宿主握手探针 [feat: voice-dispatch-minimal] 2026-08-21
//
// 把「钉死①」端到端验穿:按 `resolveAcpHost` 解析出的命令真起一个 ACP,发 `initialize`,
// 看回的是不是干净的 ndJSON,并把 stdout 里的**非协议行**统计出来 —— 那就是 S1 wrapper 要
// 过滤掉的噪声,这里先量出基线(spike 时代是 55 行里 54 行噪声)。
//
// 为什么必须有这条:D-G 之前的方案是"指内置 sidecar",实测发现装好的 app 里**根本没有**
// opencode CLI,而 dev 树那个是 v2 世代(落 opencode-next.db)。宿主选错不会报错,只会
// 悄悄跑在另一套数据上 —— 这条探针把"跑的是哪个核心、落哪个库"直接打出来。
//
//   bun acp-handshake.mjs                          # 用本仓
//   bun acp-handshake.mjs --repo /path/to/fork     # 指定仓
//   bun acp-handshake.mjs --isolate                # 落到临时 XDG,不碰真数据
import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { applyVoiceHarnessXdg, assessAgentVersion, resolveAcpHost } from "../../../src/main/deskfox/voice/launch-env.ts"

const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv[i + 1] : d
}
const isolate = argv.includes("--isolate")
// 本文件在 <repo>/packages/desktop/scripts/local-test/voice/ 下,上溯 5 级即仓根
const repoRoot = arg("--repo", path.resolve(import.meta.dir, "..", "..", "..", "..", ".."))

// --via-wrapper:走 deskfox-acp-wrap.mjs(生产路径),验证管道级过滤真的把噪声挡在 stdout 之外。
// 不带则直连宿主,量的是【过滤前】的原始噪声基线。
const viaWrapper = argv.includes("--via-wrapper")

let host
try {
  host = resolveAcpHost({ repoRoot, env: process.env })
  if (viaWrapper) {
    host = {
      ...host,
      command: process.execPath,
      args: [path.resolve(import.meta.dir, "..", "..", "deskfox-acp-wrap.mjs"), "acp"],
    }
  }
} catch (e) {
  console.error(`❌ ${e?.message ?? e}`)
  process.exit(3)
}

let env = applyVoiceHarnessXdg({ ...process.env, OPENCODE_CLIENT: "acp" })
if (isolate) {
  const box = mkdtempSync(path.join(tmpdir(), "voice-acp-"))
  env = { ...env, XDG_DATA_HOME: path.join(box, "data"), XDG_CONFIG_HOME: path.join(box, "config"), XDG_STATE_HOME: path.join(box, "state") }
  console.log(`隔离模式:XDG → ${box}`)
}

console.log(`宿主:${host.command} ${host.args.join(" ")}`)
console.log(`XDG_DATA_HOME:${env.XDG_DATA_HOME}\n`)

const child = spawn(host.command, host.args, { env, stdio: ["pipe", "pipe", "pipe"] })
const stdoutLines = []
const stderrChunks = []
let buf = ""

child.stdout.on("data", (d) => {
  buf += d.toString()
  const parts = buf.split("\n")
  buf = parts.pop() ?? ""
  for (const line of parts) if (line.trim()) stdoutLines.push(line)
})
child.stderr.on("data", (d) => stderrChunks.push(d.toString()))
child.on("error", (e) => {
  console.error(`❌ 起不来:${e.message}`)
  process.exit(3)
})

child.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: 1, clientCapabilities: {} },
  }) + "\n",
)

// ACP 是长连接,给足冷启动时间(源码态首跑要编译),拿到结果就收工
const deadline = Date.now() + Number(arg("--timeout", "90000"))
let result = null
while (Date.now() < deadline && !result) {
  await new Promise((r) => setTimeout(r, 500))
  for (const line of stdoutLines) {
    try {
      const o = JSON.parse(line)
      if (o.jsonrpc === "2.0" && o.id === 1) {
        result = o
        break
      }
    } catch {}
  }
}
child.kill()

const isAcpFrame = (line) => {
  try {
    return JSON.parse(line)?.jsonrpc === "2.0"
  } catch {
    return false
  }
}
const noise = stdoutLines.filter((l) => !isAcpFrame(l))
const agentInfo = result?.result?.agentInfo ?? {}
const versionCheck = assessAgentVersion(String(agentInfo.version ?? ""))

console.log(`stdout 共 ${stdoutLines.length} 行,其中协议行 ${stdoutLines.length - noise.length}、噪声 ${noise.length}`)
if (noise.length) {
  console.log("噪声样例(S1 wrapper 要过滤掉的就是这些):")
  for (const l of noise.slice(0, 5)) console.log(`  · ${l.slice(0, 140)}`)
}

const checks = [
  { ok: !!result, name: "initialize 有响应", detail: result ? "" : "超时;stderr 见下" },
  { ok: result?.result?.protocolVersion === 1, name: "protocolVersion = 1", detail: String(result?.result?.protocolVersion ?? "—") },
  { ok: !!agentInfo.name, name: "agentInfo 完整", detail: `${agentInfo.name ?? "?"} ${agentInfo.version ?? "?"}` },
  { ok: versionCheck.level !== "stale", name: "不是老 opencode", detail: versionCheck.note },
  { ok: noise.length === 0, name: "stdout 无噪声(S1 前预期为 ❌,S1 后必须 ✅)", detail: `${noise.length} 行` },
]

console.log("")
let failed = 0
for (const c of checks) {
  if (!c.ok) failed++
  console.log(`${c.ok ? "✅" : "❌"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`)
}
if (!result && stderrChunks.length) {
  console.log("\n--- stderr(前 20 行)---")
  console.log(stderrChunks.join("").split("\n").slice(0, 20).join("\n"))
}
// 噪声那条在 S1 落地前必红,不算失败;真正的失败是握不上手
process.exit(result && checks[1].ok ? 0 : 1)
