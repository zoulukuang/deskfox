#!/usr/bin/env bun
// [fork-only] voice-acp-bridge — 语音桥进程入口 [feat: voice-acp-bridge] 2026-08-24
//
// qwen-audio-agent 通过 `ACP_COMMAND` 把这个文件当可执行文件 spawn,与它之间说 ACP(stdio 上的 NDJSON);
// 我们这边把每个 ACP 方法翻译成对 DeskFox sidecar 的 HTTP 调用。于是**语音派出的每一条 session
// 都是 DeskFox 自己建的**,跟手敲出来的完全同源(1-spec R3/R6)。
//
// 这里只做 wiring:配置、日志、信号、把 stdin/stdout 接上桥。逻辑全在
// `src/main/deskfox/voice/bridge/`(TS,有单测覆盖)。
//
// ⚠️ **stdout 是协议通道**。这个文件里任何一处 `console.log` 都会污染帧流,
// 而 qwen 对非 JSON 行是"静默跳过",坏起来没有现场。日志一律 stderr / 文件。

import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { readBridgeConfig } from "../src/main/deskfox/voice/bridge/env.ts"
import { assertContractSelfConsistent } from "../src/main/deskfox/voice/bridge/contract.ts"
import { createBridge } from "../src/main/deskfox/voice/bridge/bridge.ts"
import { createSidecarClient } from "../src/main/deskfox/voice/bridge/sidecar.ts"
import { readActiveProject } from "../src/main/deskfox/voice/active-project.ts"

let logFile = ""
const log = (message) => {
  const line = `${new Date().toISOString()} [voice-bridge] ${message}`
  process.stderr.write(`${line}\n`)
  if (!logFile) return
  try {
    mkdirSync(dirname(logFile), { recursive: true })
    appendFileSync(logFile, `${line}\n`)
  } catch {}
}

let config
try {
  assertContractSelfConsistent()
  config = readBridgeConfig(process.env)
  logFile = config.logFile
} catch (e) {
  // 配置/契约不对就**立刻退出**,不要带着半截配置跑起来 —— qwen 会把 stderr 拼进用户可见的报错
  process.stderr.write(`${String(e?.message ?? e)}\n`)
  process.exit(1)
}

log(
  `启动 pid=${process.pid} sidecar=${config.serverUrl} voiceDir=${config.voiceDir} ` +
    `coordinator模型=${config.coordinatorModel ? `${config.coordinatorModel.providerID}/${config.coordinatorModel.modelID}` : "(跟随绑定)"}`,
)

const sidecar = createSidecarClient({
  baseUrl: config.serverUrl,
  authorization: config.authorization,
  log,
})

const bridge = createBridge({
  sidecar,
  voiceDir: config.voiceDir,
  coordinatorModel: config.coordinatorModel,
  taskModel: config.taskModel,
  readActiveProject: () => (config.activeProjectFile ? readActiveProject(config.activeProjectFile) : ""),
  write: (line) => process.stdout.write(`${line}\n`),
  log,
})

process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => bridge.peer.handleChunk(String(chunk)))
process.stdin.on("end", () => {
  bridge.peer.finish()
  bridge.dispose()
  process.exit(0)
})

// qwen 关闭时对**进程组**发 SIGTERM,750ms 后 SIGKILL(`acp-process-client.mjs:619-643`)。
// 那 750ms 够我们把在途轮次收干净了。
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    log(`收到 ${sig},收尾退出`)
    try {
      bridge.dispose()
    } catch {}
    process.exit(0)
  })
}

process.on("uncaughtException", (e) => {
  // 不退出:单个请求处理炸掉不该让整条语音链路死掉(qwen 那边没有自动重连,进程一没就得等下一次任务)
  log(`未捕获异常(已吞):${String(e?.stack ?? e)}`)
})
process.on("unhandledRejection", (e) => {
  log(`未处理的 Promise 拒绝(已吞):${String(e?.stack ?? e)}`)
})
