#!/usr/bin/env bun
// [fork-only] REQ-102 语音派活 — ACP stdout 净化 wrapper [feat: voice-dispatch-minimal] 2026-08-21
//
// qwen-audio-agent 把 `OPENCODE_BIN` 当 opencode 可执行文件来 spawn(`scripts/opencode.mjs`),
// 所以我们把它指到本文件:由本文件去起真正的 ACP 宿主,并在**管道级**把 stdout 洗干净 ——
// 只有 `jsonrpc:"2.0"` 的行进 stdout,其余(插件日志 / SDK logger / native 直写)全部转 stderr。
//
// 为什么不在进程内改 `acp.ts`(D-E):
//   ① Bun 下 patch `process.stdout.write` 拦不到 `console.log`(实测 bun 0 / node 1),宿主正是 bun;
//   ② 管道级源无关,连 native 写 fd 1 也拦得住;
//   ③ 零上游改动、零 R4 override、上游 sync 永不冲突,也不改变 `opencode acp` 对 Zed 等
//      其他消费方的行为(那是原计划待钉死项 #4 担心的事)。
//
// 宿主是**本仓 1.x 源码入口**(D-G):`bun <repoRoot>/packages/opencode/src/index.ts acp`。
// 不是 `resources/opencode-cli` —— 那个是 opencode2/v2 世代,落 `opencode-next.db`,
// 用它则「语音派的活在 DeskFox 会话列表里可见」直接归零。
//
// 用法(正常由 DeskFox 主进程注入 env,手工调试时):
//   DESKFOX_VOICE_REPO_ROOT=/path/to/fork bun deskfox-acp-wrap.mjs [透传给 acp 的参数…]
// 调试/测试专用:
//   DESKFOX_ACP_HOST_COMMAND=<cmd> DESKFOX_ACP_HOST_ARGS='a,b' → 用指定命令替代真宿主
import { spawn } from "node:child_process"
import { createLineSplitter, isAcpFrame } from "../src/main/deskfox/voice/acp-frame.ts"
import { assessAgentVersion, resolveAcpHost } from "../src/main/deskfox/voice/launch-env.ts"

const NOISE_PREFIX = "[acp-wrap] "
const writeErr = (s) => process.stderr.write(s.endsWith("\n") ? s : `${s}\n`)

// qwen 的 launcher 是 `spawnAndProxy(OPENCODE_BIN, [COMMAND, ...EXTRA])`(`scripts/opencode.mjs:63-70`),
// 也就是**它会把 `acp` 当参数传进来**。所以调用方给了参数就用调用方的,别再拼一次默认的 `acp`
// (拼成 `acp acp` 会被 yargs 当成未知参数)。
const passthrough = process.argv.slice(2)

let command
let args
const overrideCommand = String(process.env.DESKFOX_ACP_HOST_COMMAND ?? "").trim()
if (overrideCommand) {
  // 仅用于测试/调试:身份由构造保证的前提在这条路径上是**放弃**的,所以显式记一行,别静默
  command = overrideCommand
  args = [
    ...String(process.env.DESKFOX_ACP_HOST_ARGS ?? "")
      .split(",")
      .filter(Boolean),
    ...passthrough,
  ]
  writeErr(`${NOISE_PREFIX}⚠️ 用了 DESKFOX_ACP_HOST_COMMAND 覆盖宿主:${command} ${args.join(" ")}`)
} else {
  try {
    const host = resolveAcpHost({ env: process.env })
    command = host.command
    // 调用方带了子命令(qwen 会带 `acp`)→ 用它;没带 → 用默认的 `acp`
    args = passthrough.length ? [host.entry, ...passthrough] : [...host.args]
  } catch (e) {
    // 起不来要说人话:语音入口据此禁用,而不是让用户对着一个不响应的麦克风图标发呆
    writeErr(`${NOISE_PREFIX}❌ ${e?.message ?? e}`)
    process.exit(3)
  }
}

const child = spawn(command, args, {
  env: { ...process.env, OPENCODE_CLIENT: "acp" },
  stdio: ["pipe", "pipe", "pipe"],
})

child.on("error", (e) => {
  writeErr(`${NOISE_PREFIX}❌ 起不来 ${command}:${e.message}`)
  process.exit(3)
})

// stdin 原样透传(ACP 是双向 ndJSON,不许在这个方向上做任何加工)
process.stdin.pipe(child.stdin)
child.stdin.on("error", () => {}) // 子进程先退时的 EPIPE,不值得吵

// stderr 原样转发,前缀保留子进程原貌以便排查
child.stderr.on("data", (d) => process.stderr.write(d))

const splitter = createLineSplitter()
let frameCount = 0
let noiseCount = 0
let versionLogged = false

const handleLine = (line) => {
  if (isAcpFrame(line)) {
    frameCount++
    process.stdout.write(`${line}\n`)
    // 首个 initialize 响应里带 agentInfo.version:顺手核一眼跑的是不是老 opencode
    if (!versionLogged && line.includes("agentInfo")) {
      versionLogged = true
      try {
        const v = JSON.parse(line)?.result?.agentInfo?.version
        if (v !== undefined) {
          const a = assessAgentVersion(String(v))
          if (a.level === "stale") writeErr(`${NOISE_PREFIX}⚠️ ${a.note}`)
          else writeErr(`${NOISE_PREFIX}宿主 ${a.note}`)
        }
      } catch {}
    }
    return
  }
  noiseCount++
  writeErr(`${NOISE_PREFIX}${line}`)
}

child.stdout.on("data", (d) => {
  for (const line of splitter.push(d.toString())) handleLine(line)
})

child.stdout.on("end", () => {
  for (const line of splitter.flush()) handleLine(line)
})

const forward = (sig) => {
  process.on(sig, () => {
    try {
      child.kill(sig)
    } catch {}
  })
}
forward("SIGINT")
forward("SIGTERM")
forward("SIGHUP")

child.on("close", (code, signal) => {
  for (const line of splitter.flush()) handleLine(line)
  writeErr(`${NOISE_PREFIX}宿主退出 code=${code ?? "-"} signal=${signal ?? "-"};协议帧 ${frameCount}、噪声 ${noiseCount}`)
  process.exit(typeof code === "number" ? code : 1)
})
