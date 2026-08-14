import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { app, utilityProcess } from "electron"
import type { Details } from "electron"
import { CHANNEL } from "./constants"
// FORK: local 档配置隔离 [feat: local-config-isolation] 2026-08-12
import { needsConfigDirEnv } from "./deskfox/config-dir"
import { resolveDeskfoxConfigDir } from "./deskfox/config-dir-resolve"
import { getLogger } from "./logging"
import { getUserShell, loadShellEnv } from "./shell-env"
import { getStore } from "./store"
import { DEFAULT_SERVER_URL_KEY } from "./store-keys"

export type HealthCheck = { wait: Promise<void> }

type SidecarMessage =
  | { type: "ready" }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }
  // FORK: REQ-049 内存压力上报(sidecar 侧 memory-brake 采样)[feat: sidecar-oom-brake] 2026-08-02
  | { type: "memory-pressure"; usedMB: number; limitMB: number; ratio: number }

// FORK: REQ-049 L1 硬帽 — sidecar V8 老生代上限,撑爆快速 OOM 由 L2 看门狗秒级 respawn,
//   不再拖垮整机内存(2026-06-03 飞书白屏连累实证)。[feat: sidecar-oom-brake] 2026-08-02
export const SIDECAR_MAX_OLD_SPACE_MB = 3072

export type SidecarMemoryPressure = { usedMB: number; limitMB: number; ratio: number }

export type SidecarListener = { stop: () => Promise<void> }

const SIDECAR_SERVICE_NAME = "opencode server"
const SIDECAR_START_STALL_TIMEOUT = 60_000
const SIDECAR_STOP_TIMEOUT = 6_000

type SpawnLocalServerOptions = {
  userDataPath: string
  onStdout?: (message: string) => void
  onStderr?: (message: string) => void
  onExit?: (code: number) => void
  // FORK: REQ-049 内存压力回调 [feat: sidecar-oom-brake] 2026-08-02
  onMemoryPressure?: (info: SidecarMemoryPressure) => void
}

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

export function preferAppEnv(userDataPath: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? loadShellEnv(shell, getLogger()) : null
  Object.assign(process.env, {
    ...shellEnv,
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_CLIENT: "desktop",
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
  })
  return shellEnv
}

export async function spawnLocalServer(
  hostname: string,
  port: number,
  password: string,
  options: SpawnLocalServerOptions,
) {
  const sidecar = join(dirname(fileURLToPath(import.meta.url)), "sidecar.js")
  const child = utilityProcess.fork(sidecar, [], {
    cwd: process.cwd(),
    env: createSidecarEnv(),
    serviceName: SIDECAR_SERVICE_NAME,
    stdio: "pipe",
    // FORK: REQ-049 L1 硬帽 [feat: sidecar-oom-brake] 2026-08-02
    execArgv: [`--max-old-space-size=${SIDECAR_MAX_OLD_SPACE_MB}`],
  })
  let exited = false
  const exit = defer<number>()

  const onProcessGone = (_event: unknown, details: Details) => {
    if (details.type !== "Utility" || details.name !== SIDECAR_SERVICE_NAME) return
    options.onStderr?.(`utility process gone reason=${details.reason} exitCode=${details.exitCode}`)
  }

  app.on("child-process-gone", onProcessGone)
  child.once("exit", (code) => {
    exited = true
    app.off("child-process-gone", onProcessGone)
    options.onExit?.(code)
    exit.resolve(code)
  })
  child.on("error", (error) => options.onStderr?.(`utility process error: ${serializeError(error).message}`))
  // FORK: REQ-049 内存压力消息常驻转发(与启动期 onMessage 监听互不影响)[feat: sidecar-oom-brake] 2026-08-02
  child.on("message", (message: SidecarMessage) => {
    if (message.type === "memory-pressure") options.onMemoryPressure?.(message)
  })

  child.stdout?.on("data", (chunk: Buffer) => options.onStdout?.(chunk.toString("utf8").trimEnd()))
  child.stderr?.on("data", (chunk: Buffer) => options.onStderr?.(chunk.toString("utf8").trimEnd()))

  await new Promise<void>((resolve, reject) => {
    let done = false
    let timeout: NodeJS.Timeout

    const fail = (error: Error) => {
      if (done) return
      done = true
      cleanup()
      reject(error)
    }

    const refreshTimeout = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        fail(new Error(`Sidecar did not become ready within ${SIDECAR_START_STALL_TIMEOUT}ms: ${sidecar}`))
      }, SIDECAR_START_STALL_TIMEOUT)
    }

    const onMessage = (message: SidecarMessage) => {
      if (message.type === "ready") {
        if (done) return
        done = true
        cleanup()
        resolve()
        return
      }
      if (message.type === "error") {
        fail(Object.assign(new Error(message.error.message), { stack: message.error.stack }))
      }
    }
    const onExit = (code: number) => {
      fail(new Error(`Sidecar exited before ready with code ${code}`))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.off("message", onMessage)
      child.off("exit", onExit)
    }

    child.on("message", onMessage)
    child.on("exit", onExit)
    refreshTimeout()
    child.postMessage({
      type: "start",
      hostname,
      port,
      password,
      userDataPath: options.userDataPath,
    })
  }).catch((error) => {
    if (!exited) child.kill()
    throw error
  })

  const wait = (async () => {
    const url = `http://${hostname}:${port}`
    let healthy = false
    const gone = exit.promise.then((code) => {
      if (healthy) return
      throw new Error(`Sidecar exited before health check passed with code ${code}`)
    })

    const ready = async () => {
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (await checkHealth(url, password)) {
          healthy = true
          return
        }
      }
    }

    await Promise.race([ready(), gone])
  })()

  let stopping: Promise<void> | undefined

  return {
    listener: {
      stop: () => {
        if (stopping) return stopping
        if (exited) return Promise.resolve()
        child.postMessage({ type: "stop" })
        stopping = Promise.race([
          exit.promise.then(() => undefined),
          delay(SIDECAR_STOP_TIMEOUT).then(() => {
            if (!exited) child.kill()
          }),
        ])
        return stopping
      },
    },
    health: { wait },
  }
}

export async function checkHealth(url: string, password?: string | null): Promise<boolean> {
  let healthUrls: URL[]
  try {
    healthUrls = [new URL("/api/health", url), new URL("/global/health", url)]
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`opencode:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  for (const healthUrl of healthUrls) {
    try {
      const res = await fetch(healthUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok) return true
    } catch {}
  }
  return false
}

function createSidecarEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)]])),
  )
  delete env.DEBUG
  if (process.platform === "linux") delete env.LD_PRELOAD
  // FORK: 数据库归属按身份分流 [feat: local-channel] 2026-06-17 —
  //  · 发布渠道(预览/Beta/正式):统一 opencode.db(OPENCODE_DISABLE_CHANNEL_DB=1)— 对齐 Tauri 版行为
  //    (build 时烤 OPENCODE_CHANNEL=prod,401-fix),保证打包后 dev/beta 渠道升级时老用户会话/DB 不"消失"。
  //  · 本地测试版(local / 未打包):显式 OPENCODE_CHANNEL=local → sidecar 落 opencode-local.db,
  //    与正式版 opencode.db 隔离,本机灌测试数据/折腾不污染正式版(详见治理规范 §3.11)。
  if (!app.isPackaged || CHANNEL === "local") {
    env.OPENCODE_CHANNEL = "local"
    delete env.OPENCODE_DISABLE_CHANNEL_DB
  } else {
    env.OPENCODE_DISABLE_CHANNEL_DB = "1"
  }
  // FORK: local 档配置隔离 —— 让 sidecar 读独立的 opencode-local 配置目录,
  //   与发布渠道的 opencode 目录分家(数据/身份早已隔离,配置是最后一块)。
  //   走上游既有的 OPENCODE_CONFIG_DIR(Global.Path.config = Flag.OPENCODE_CONFIG_DIR ?? Path.config),
  //   零改上游。发布渠道不注入 → 保持默认位置不变。
  //   [feat: local-config-isolation] 2026-08-12
  if (needsConfigDirEnv(CHANNEL, app.isPackaged)) {
    env.OPENCODE_CONFIG_DIR = resolveDeskfoxConfigDir(app.isPackaged)
  }
  return env
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
