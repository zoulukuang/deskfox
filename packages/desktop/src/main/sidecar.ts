import * as http from "node:http"
import * as tls from "node:tls"
// FORK: 国内 npm 镜像注入(从 Tauri npm_registry.rs 平移)[feat: npm-registry-cn-mirror] 2026-06-13
import { decideNpmRegistry } from "./deskfox/npm-registry"
// FORK-BEGIN: REQ-049 L1 内存软刹车 [feat: sidecar-oom-brake] 2026-08-02
import v8 from "node:v8"
import { createMemoryPressureMonitor, type MemoryPressureEvent } from "./deskfox/memory-brake"

const MEMORY_SAMPLE_INTERVAL_MS = 30_000
let memoryTimer: ReturnType<typeof setInterval> | undefined

function startMemoryWatch(port: ParentPort) {
  if (memoryTimer) return
  const monitor = createMemoryPressureMonitor({
    sample: () => {
      const stats = v8.getHeapStatistics()
      return { usedBytes: stats.used_heap_size, limitBytes: stats.heap_size_limit }
    },
    emit: (event) => port.postMessage(event),
  })
  memoryTimer = setInterval(() => monitor.check(), MEMORY_SAMPLE_INTERVAL_MS)
  memoryTimer.unref?.()
}
// FORK-END

type NodeHttpWithEnvProxy = typeof http & {
  setGlobalProxyFromEnv: () => void
}

type NodeTlsWithSystemCertificates = typeof tls & {
  getCACertificates: (type: "default" | "system") => string[]
  setDefaultCACertificates: (certificates: string[]) => void
}

type StartCommand = {
  type: "start"
  hostname: string
  port: number
  password: string
  userDataPath: string
}

type StopCommand = { type: "stop" }
type SidecarCommand = StartCommand | StopCommand

type SidecarMessage =
  | { type: "ready" }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }
  // FORK: REQ-049 内存压力上报 [feat: sidecar-oom-brake] 2026-08-02
  | MemoryPressureEvent

type ParentPort = {
  postMessage(message: SidecarMessage): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
}

type Listener = {
  stop(close?: boolean): void | Promise<void>
}

const parentPort = getParentPort()
let listener: Listener | undefined

parentPort.on("message", (event) => {
  const command = parseCommand(event.data)
  if (!command) return
  if (command.type === "stop") {
    void stop()
    return
  }
  void start(command)
})

async function start(command: StartCommand) {
  try {
    prepareSidecarEnv(command.password, command.userDataPath)
    ensureLoopbackNoProxy()
    useSystemCertificates()
    useEnvProxy()
    const { Server } = await import("virtual:opencode-server")

    listener = await Server.listen({
      port: command.port,
      hostname: command.hostname,
      username: "opencode",
      password: command.password,
      cors: ["oc://renderer"],
    })
    parentPort.postMessage({ type: "ready" })
    // FORK: REQ-049 启动即开始 heap 采样(30s 周期,80% 阈值上报)[feat: sidecar-oom-brake] 2026-08-02
    startMemoryWatch(parentPort)
  } catch (error) {
    parentPort.postMessage({ type: "error", error: serializeError(error) })
    setImmediate(() => process.exit(1))
  }
}

async function stop() {
  try {
    await listener?.stop()
  } finally {
    listener = undefined
    parentPort.postMessage({ type: "stopped" })
    setImmediate(() => process.exit(0))
  }
}

function prepareSidecarEnv(password: string, userDataPath: string) {
  Object.assign(process.env, {
    OPENCODE_SERVER_USERNAME: "opencode",
    OPENCODE_SERVER_PASSWORD: password,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
    // FORK: REQ-069/072 放开非 git 文件夹稳定身份 flag(版本计划 v2026-07-05 D 决策)。 2026-07-05
    //   开启后:普通文件夹改名/挪位仍认得同一项目(锚 .deskfox/id),且 git+非git 项目打开时都写锚
    //   → 会话侧栏按 project_id 跟随身份(REQ-072)、改名后可锚扫描 relocate(见 desktop main relocate IPC)。
    //   用户已显式设则尊重不覆盖(便于回退/灰度)。M8 存量 global 析出按 v2026.6.25 灰度预案。
    OPENCODE_EXPERIMENTAL_NONGIT_IDENTITY: process.env.OPENCODE_EXPERIMENTAL_NONGIT_IDENTITY ?? "1",
  })
  // FORK: 国内用户装插件走国内镜像(npm_config_registry 由 @npmcli/config 读),官方用户不注入
  //   [feat: npm-registry-cn-mirror] 2026-06-13。用户已显式设了 registry 则尊重不覆盖。
  if (!process.env.npm_config_registry) {
    const registry = decideNpmRegistry(userDataPath)
    if (registry) process.env.npm_config_registry = registry
  }
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

function useSystemCertificates() {
  try {
    const nodeTls = tls as NodeTlsWithSystemCertificates
    nodeTls.setDefaultCACertificates([
      ...new Set([...nodeTls.getCACertificates("default"), ...nodeTls.getCACertificates("system")]),
    ])
  } catch (error) {
    console.warn("failed to load system certificates", error)
  }
}

function useEnvProxy() {
  try {
    ;(http as NodeHttpWithEnvProxy).setGlobalProxyFromEnv()
  } catch (error) {
    console.warn("failed to load proxy environment", error)
  }
}

function parseCommand(value: unknown): SidecarCommand | undefined {
  if (!value || typeof value !== "object") return
  const command = value as Partial<StartCommand | StopCommand>
  if (command.type === "stop") return { type: "stop" }
  if (command.type !== "start") return
  if (typeof command.hostname !== "string") return
  if (typeof command.port !== "number") return
  if (typeof command.password !== "string") return
  if (typeof command.userDataPath !== "string") return
  return {
    type: "start",
    hostname: command.hostname,
    port: command.port,
    password: command.password,
    userDataPath: command.userDataPath,
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function getParentPort() {
  const port = process.parentPort as ParentPort | undefined
  if (!port) throw new Error("Sidecar parent port unavailable")
  return port
}
