// [fork-only] REQ-102 语音派活 — Gateway 进程托管 [feat: voice-dispatch-minimal] 2026-08-21
//
// 点顶部栏图标 → 主进程起 `qwenaudio gateway run --backend opencode`,env 由 launch-config 构造;
// 再点关闭 → 停进程。renderer 只经 IPC 拿一个状态字符串,不碰进程细节。
//
// 为什么托管在主进程而不是 renderer:① env 里有 DASHSCOPE key,不该过 renderer;
// ② 主进程的 `process.env` 已经被 `applyDeskfoxDataNamespace()` 设好 XDG(D-A 共用命名空间
// 的前提就是子进程继承它);③ 关窗口不该把语音杀掉。
//
// 纯逻辑(判定/解析/拼参数)全部抽成可测函数,spawn 与 fetch 走注入,单测不起真进程。

import { spawn, type ChildProcess } from "node:child_process"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import log from "electron-log/main.js"
import { GATEWAY_PORT, binDir, buildGatewayEnv, checkVoiceWorkspace } from "./launch-config"
import { resolveAcpHost } from "./launch-env"

const execFileAsync = promisify(execFile)

export type VoiceState = "unavailable" | "off" | "starting" | "on" | "error"

export interface VoiceStatus {
  readonly state: VoiceState
  /** 给 tooltip 用的人话;unavailable / error 时必须能指导下一步 */
  readonly detail: string
  readonly gatewayUrl?: string
}

// ───────────────────────────── 纯逻辑 ─────────────────────────────

export interface SetupProbe {
  readonly ready: boolean
  readonly issue: string
}

/**
 * 解析 `qwenaudio setup --backend opencode --json` 的输出。
 * 拿不准一律当"没装好"—— 语音入口宁可禁用并说清原因,也不要点了没反应。
 */
export function parseSetupJson(stdout: string): SetupProbe {
  try {
    const data = JSON.parse(stdout) as {
      backends?: Array<{ id?: string; ready?: boolean; issue?: string; backend?: { source?: string } }>
    }
    const entry = data.backends?.find((b) => b.id === "opencode")
    if (!entry) return { ready: false, issue: "qwenaudio 没报告 opencode 后端" }
    if (entry.ready) return { ready: true, issue: "" }
    return { ready: false, issue: entry.issue || "qwenaudio 报告 opencode 后端未就绪" }
  } catch {
    return { ready: false, issue: "qwenaudio setup 输出不是 JSON(版本不符?)" }
  }
}

/** Gateway 启动参数。`run` 是前台跑法 —— 我们自己托管进程,不用它的 install/start 后台服务。 */
export function buildGatewayArgs(): string[] {
  return ["gateway", "run", "--backend", "opencode"]
}

export function gatewayHealthUrl(port: number = GATEWAY_PORT): string {
  return `http://127.0.0.1:${port}/api/health`
}

/** 把内部状态映射成 renderer 要的 status(集中一处,免得两边各判各的)。 */
export function deriveStatus(input: {
  readonly available: SetupProbe | null
  readonly running: boolean
  readonly starting: boolean
  readonly lastError: string
}): VoiceStatus {
  if (input.lastError) return { state: "error", detail: input.lastError }
  if (input.available && !input.available.ready) return { state: "unavailable", detail: input.available.issue }
  if (input.starting) return { state: "starting", detail: "正在启动语音网关…" }
  if (input.running) return { state: "on", detail: "语音派活已开启", gatewayUrl: `http://127.0.0.1:${GATEWAY_PORT}` }
  return { state: "off", detail: "点击开启语音派活" }
}

// ───────────────────────────── 进程托管 ─────────────────────────────

let child: ChildProcess | null = null
let starting = false
let lastError = ""
let availability: SetupProbe | null = null

export interface StartInput {
  /** DeskFox 当前窗口的项目目录 */
  readonly workspace: string
  /** fork 仓根(D-G:ACP 宿主要用) */
  readonly repoRoot: string
  readonly wrapperPath: string
  /** 与主实例一致的 db 分流(见 launch-config 的同名字段) */
  readonly disableChannelDb: boolean
}

export interface ProbeInput {
  /** wrapper 绝对路径 —— **必须给**,理由见函数注释 */
  readonly wrapperPath: string
  readonly extraPathDirs?: readonly string[]
}

/**
 * 探测 qwen-audio-agent 装没装好;结果缓存,`force` 可重探。
 *
 * 两个坑都是 2026-08-21 真机点按钮才暴露的:
 *   ① **必须带 `OPENCODE_BIN`**。不带的话 `setup` 会去找 PATH 上"已安装的 opencode",
 *      在本机那是 homebrew 的 **1.17.4** → `ready:false`;带上 wrapper 则 `source: configured`
 *      → 跳过版本闸 → ready。
 *   ② **非零退出也要读 stdout**。`setup` 在 not-ready 时 exit 1,但**照样打完整 JSON**;
 *      只 catch 不解析就会把"1.17.4 太旧"这种可执行的原因丢掉,退化成一句没用的"命令失败"。
 */
export async function probeAvailability(input: ProbeInput, force = false): Promise<SetupProbe> {
  if (availability && !force) return availability
  const pathDirs = [...(input.extraPathDirs ?? []), ...String(process.env.PATH ?? "").split(":")]
  const env = {
    ...process.env,
    OPENCODE_BIN: input.wrapperPath,
    PATH: pathDirs.filter(Boolean).join(":"),
  }
  try {
    const { stdout } = await execFileAsync("qwenaudio", ["setup", "--backend", "opencode", "--json"], {
      timeout: 30_000,
      env,
    })
    availability = parseSetupJson(stdout)
  } catch (e) {
    const err = e as { message?: string; stdout?: string }
    const stdout = String(err?.stdout ?? "")
    if (stdout.trim().startsWith("{")) {
      availability = parseSetupJson(stdout)
      return availability
    }
    const msg = String(err?.message ?? e)
    availability = {
      ready: false,
      issue: /ENOENT|not found/i.test(msg)
        ? "未安装 qwen-audio-agent —— 终端跑 `npm i -g qwen-audio-agent@1.11.0` 后重试"
        : `qwenaudio setup 失败:${msg}`,
    }
  }
  return availability
}

export function getVoiceStatus(): VoiceStatus {
  return deriveStatus({ available: availability, running: !!child, starting, lastError })
}

export async function startVoiceGateway(input: StartInput): Promise<VoiceStatus> {
  if (child) return getVoiceStatus()
  lastError = ""

  // R3 护栏:非 git 仓库根一律拒起(语音要以全开权限改文件,git 是最后的撤销手段)
  const ws = checkVoiceWorkspace(input.workspace)
  if (!ws.ok) {
    lastError = ws.reason
    return getVoiceStatus()
  }

  // bun 给 wrapper 的 shebang 用;claude CLI 给 claude-code provider 用 —— GUI 进程的 PATH 常常两个都没有
  const extraPathDirs: string[] = []
  try {
    const host = resolveAcpHost({ repoRoot: input.repoRoot, env: process.env })
    const d = binDir(host.command)
    if (d && host.command.includes("/")) extraPathDirs.push(d)
  } catch (e) {
    lastError = String((e as { message?: string })?.message ?? e)
    return getVoiceStatus()
  }

  const probe = await probeAvailability({ wrapperPath: input.wrapperPath, extraPathDirs })
  if (!probe.ready) return getVoiceStatus()

  const { env, warnings } = buildGatewayEnv({
    workspace: ws.dir,
    repoRoot: input.repoRoot,
    wrapperPath: input.wrapperPath,
    env: process.env,
    extraPathDirs,
    disableChannelDb: input.disableChannelDb,
  })
  for (const w of warnings) log.warn(`[voice] ${w}`)

  starting = true
  const proc = spawn("qwenaudio", buildGatewayArgs(), { env, stdio: ["ignore", "pipe", "pipe"] })
  child = proc
  proc.stdout?.on("data", (d) => log.info(`[voice-gateway] ${String(d).trimEnd()}`))
  proc.stderr?.on("data", (d) => log.warn(`[voice-gateway] ${String(d).trimEnd()}`))
  proc.on("error", (e) => {
    lastError = `语音网关起不来:${e.message}`
    starting = false
    child = null
  })
  proc.on("exit", (code, signal) => {
    log.info(`[voice] gateway exited code=${code} signal=${signal}`)
    // 非我们主动停的退出要留痕,否则图标会莫名其妙变回"关"
    if (child === proc && code !== 0 && code !== null) lastError = `语音网关意外退出(code=${code})`
    starting = false
    if (child === proc) child = null
  })

  const healthy = await waitForHealth()
  starting = false
  if (!healthy && child) {
    lastError = "语音网关启动超时 —— 看 DeskFox 日志里的 [voice-gateway] 行"
  }
  return getVoiceStatus()
}

async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!child) return false
    try {
      const res = await fetch(gatewayHealthUrl(), { signal: AbortSignal.timeout(3000) })
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

export async function stopVoiceGateway(): Promise<VoiceStatus> {
  const proc = child
  child = null
  starting = false
  lastError = ""
  if (!proc) return getVoiceStatus()
  proc.kill("SIGTERM")
  // 给它自己收尾的机会;超时再 SIGKILL,免得 3101/4396 端口留着不放
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      try {
        proc.kill("SIGKILL")
      } catch {}
      resolve()
    }, 5000)
    proc.once("exit", () => {
      clearTimeout(t)
      resolve()
    })
  })
  return getVoiceStatus()
}

/** app 退出时收尾,别把 Gateway 留成孤儿进程。 */
export function shutdownVoiceGateway(): void {
  if (!child) return
  try {
    child.kill("SIGTERM")
  } catch {}
  child = null
}
