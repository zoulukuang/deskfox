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

import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { BrowserWindow, shell } from "electron"
import log from "electron-log/main.js"
import { acpSessionStatePath, invalidateCoordinatorOnModelChange } from "./coordinator-state"
import { archiveCoordinator, createJournalState, syncJournal, type JournalState } from "./journal-writer"
import { startTaskWatch, type TaskWatchHandle } from "./task-watch"
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

/**
 * 这次失败值不值得重试。
 *
 * 2026-08-21 真机实测:语音 ACP 宿主启动时要开**和主实例同一个** `opencode.db`
 * (D-A 共用命名空间的必然结果),而 opencode 启动阶段会跑迁移、拿排他锁;
 * 撞上主实例正在写就直接 `database is locked` → 宿主 exit 1 → Gateway "在就绪前退出"。
 * 这是 1-spec §5·R1 登记的风险真实爆发,**而且是间歇性的**(同样的命令多数时候能成)。
 * 锁是瞬态的,所以值得退避重试;不是锁的失败重试没意义,原样报出去。
 */
export function isRetryableStartFailure(output: string): boolean {
  return /database is locked|SQLITE_BUSY|Gateway 在就绪前退出|acp\.initialization_failed|Failed query/i.test(
    String(output ?? ""),
  )
}

/** Gateway 启动参数。`run` 是前台跑法 —— 我们自己托管进程,不用它的 install/start 后台服务。 */
export function buildGatewayArgs(): string[] {
  return ["gateway", "run", "--backend", "opencode"]
}

export function gatewayHealthUrl(port: number = GATEWAY_PORT): string {
  return `http://127.0.0.1:${port}/api/health`
}

/**
 * `/api/health` 说"就绪"了没有 —— **判据必须含 `backend`,不能只看 `ok`**。
 *
 * qwen 自己在代码里写明 "Gateway liveness is independent from optional backend readiness":
 * 顶层 `ok/status` 只表示 3101 这个 HTTP 服务活着,ACP 后端挂没挂它不管。
 * 2026-08-21 真机撞到的正是这个缝:首次跑到全新的语音库上,qwen 起的 backend server(4396)
 * 和我们的 ACP 宿主**并发建表**,ACP 侧 `CREATE TABLE workspace` 撞车退出,
 * 而 3101 照样 200 → 我们判定"已开启" → 用户打开界面,说话没人应。
 * 把 `backend.ok` 纳入判据后,这种半死状态会落进重试(第二次库已建好,实测干净 `acp.initialized`)。
 */
export function isBackendReady(health: unknown): boolean {
  if (!health || typeof health !== "object") return false
  const h = health as { ok?: unknown; backend?: { ok?: unknown; code?: unknown } }
  if (h.ok !== true) return false
  const backend = h.backend
  // 拿不到 backend 段就当没就绪:宁可多等一轮重试,也不要报了 on 却不能用
  if (!backend || typeof backend !== "object") return false
  return backend.ok === true || String(backend.code ?? "").toUpperCase() === "READY"
}

/**
 * 把内部状态映射成 renderer 要的 status(集中一处,免得两边各判各的)。
 *
 * `workspaceIssue` 存在时一律 **unavailable(按钮禁用)** 而不是 error —— 2026-08-21 user 真机反馈:
 * 在非 git 项目上点,拿到的是「出错了,点击重试」,可重试**永远不可能成功**(目录不会自己变成
 * git 仓库),表现就成了"点了没反应"。这种"换个项目才行"的前置条件属于**不可用**,
 * 要在点之前就说清楚,而不是让人点一次错一次。
 */
export function deriveStatus(input: {
  readonly available: SetupProbe | null
  readonly running: boolean
  readonly healthy?: boolean
  readonly starting: boolean
  readonly lastError: string
  readonly workspaceIssue?: string
}): VoiceStatus {
  // on 的判据是 **health 探通**,不是"进程还在":2026-08-21 真机遇到进程活着但 3101 从没开,
  // 按 running 判会报"已开启",用户点开却什么都没有 —— 比报错更糟。
  if (input.running && input.healthy) {
    return { state: "on", detail: "语音派活已开启", gatewayUrl: `http://127.0.0.1:${GATEWAY_PORT}` }
  }
  if (input.lastError) return { state: "error", detail: input.lastError }
  if (input.running || input.starting) return { state: "starting", detail: "正在启动语音网关…" }
  if (input.workspaceIssue) return { state: "unavailable", detail: input.workspaceIssue }
  if (input.lastError) return { state: "error", detail: input.lastError }
  if (input.available && !input.available.ready) return { state: "unavailable", detail: input.available.issue }
  return { state: "off", detail: "点击开启语音派活" }
}

// ───────────────────────────── 进程托管 ─────────────────────────────

let child: ChildProcess | null = null
let starting = false
let lastError = ""
let availability: SetupProbe | null = null
/** health 探通过才算 on —— 进程活着 ≠ 服务可用(2026-08-21 真机:进程在、3101 死,状态却报 on) */
let healthy = false
let taskWatch: TaskWatchHandle | null = null
let journalState: JournalState | null = null

/**
 * 起「任务变了就让界面重拉会话列表」的轮询。
 *
 * 必要性见 task-watch.ts:语音的 ACP 宿主是另一个 opencode 进程,跟主实例共享 db 但
 * **不共享 event bus** —— 会话写进去了,主实例毫不知情,列表就一直是旧的
 * (2026-08-21 user 真机反馈的正是这个)。
 */
function startSessionListWatch(directory: string): void {
  taskWatch?.stop()
  journalState = createJournalState()
  taskWatch = startTaskWatch({
    fetchTasks: async () => {
      const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/api/tasks`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) throw new Error(String(res.status))
      return await res.json()
    },
    // 首轮把已有任务标记成历史 —— /api/tasks 是跨会话累积的,不这么做新建的「语音沟通」
    // session 开头会凭空多出上次的几轮对话
    onPoll: (_payload, first) => {
      if (!first || !journalState) return
      void syncJournal({ directory, state: journalState, seedOnly: true })
    },
    notify: () => {
      // 先把新完成的轮次写进「语音沟通」session,再让界面刷新 —— 顺序反了会闪一下空列表
      void (async () => {
        if (journalState) await syncJournal({ directory, state: journalState })
        await archiveCurrentCoordinator(directory)
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send("deskfox:voice-session-changed")
        }
        log.info("[voice] 任务集合变化 → 已同步语音沟通记录并通知界面刷新")
      })()
    },
  })
}

/**
 * 归档当前的 coordinator session。
 *
 * 它的 id 在 qwen 的状态文件里(见 coordinator-state.ts),而且是**跑起来之后**才写进去的,
 * 所以不能在起网关那一刻读 —— 放在每轮同步里顺手做,读到了就归档一次(内部去重)。
 */
async function archiveCurrentCoordinator(directory: string): Promise<void> {
  if (!journalState) return
  try {
    const raw = readFileSync(acpSessionStatePath(), "utf8")
    const parsed = JSON.parse(raw) as { coordinators?: Record<string, { sessionId?: string }> }
    for (const [key, value] of Object.entries(parsed?.coordinators ?? {})) {
      if (!key.startsWith("opencode:")) continue
      const sessionId = String(value?.sessionId ?? "")
      if (sessionId) await archiveCoordinator({ directory, sessionId, state: journalState })
    }
  } catch {
    // 状态文件还没写出来是正常的(第一轮之前),下一轮再看
  }
}

/**
 * 语音网关日志落地。electron-log 在打包态没把这些行写到能找到的地方,而 Gateway 起不来时
 * **唯一的线索就在它的 stdout/stderr** —— 自用阶段没有日志等于没法自查。
 * 位置:`$XDG_STATE_HOME/deskfox/voice-gateway.log`,追加写,失败静默(日志不该反过来搞垮功能)。
 */
export function voiceLogPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const stateHome = env.XDG_STATE_HOME || path.join(home, ".local", "state")
  return path.join(stateHome, "deskfox", "voice-gateway.log")
}

function appendVoiceLog(line: string): void {
  try {
    const p = voiceLogPath()
    mkdirSync(path.dirname(p), { recursive: true })
    appendFileSync(p, `${new Date().toISOString()} ${line.trimEnd()}\n`)
  } catch {}
}

export interface StartInput {
  /** DeskFox 当前窗口的项目目录 */
  readonly workspace: string
  /** fork 仓根(D-G:ACP 宿主要用) */
  readonly repoRoot: string
  readonly wrapperPath: string
  /** 与主实例一致的 db 分流(见 launch-config 的同名字段) */
  readonly disableChannelDb: boolean
  /** 起来后是否自动打开语音界面(默认 true;冒烟脚本用 false) */
  readonly openUi?: boolean
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

export function getVoiceStatus(workspace?: string): VoiceStatus {
  // 没传 workspace(比如内部调用)就不做目录判定,免得凭空报"没有打开项目"
  const ws = workspace === undefined ? null : checkVoiceWorkspace(workspace)
  return deriveStatus({
    available: availability,
    running: !!child,
    healthy,
    starting,
    lastError,
    workspaceIssue: ws && !ws.ok ? ws.reason : undefined,
  })
}

export async function startVoiceGateway(input: StartInput): Promise<VoiceStatus> {
  if (child) return getVoiceStatus()
  lastError = ""

  // R3 护栏:非 git 仓库根一律拒起(语音要以全开权限改文件,git 是最后的撤销手段)。
  // 注意**不写 lastError** —— 这不是"出过错",是"当前项目不满足前置条件",
  // 由 getVoiceStatus 统一算成 unavailable(按钮禁用 + 说清换项目)。
  const ws = checkVoiceWorkspace(input.workspace)
  if (!ws.ok) return getVoiceStatus(input.workspace)

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
  healthy = false
  const backendModel = String(JSON.parse(env.OPENCODE_CONFIG_CONTENT).model ?? "")
  appendVoiceLog(`--- start workspace=${ws.dir} model=${backendModel} ---`)

  // 换了后端模型就得先把 qwen 的 coordinator session 作废,否则改了 model 是**静默失效**的
  // (它 resume 老 session,而 opencode 从历史消息恢复模型)。理由详见 coordinator-state.ts。
  const invalidated = invalidateCoordinatorOnModelChange({ backendModel })
  if (invalidated.invalidated) {
    const msg = `后端模型 ${invalidated.previousModel || "(首次)"} → ${backendModel},已作废 coordinator session:${invalidated.dropped.join(", ")}`
    log.info(`[voice] ${msg}`)
    appendVoiceLog(msg)
  }

  // 最多试 3 次:见 isRetryableStartFailure —— 与主实例抢同一个 db 的锁是瞬态的
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !healthy; attempt++) {
    if (attempt > 1) appendVoiceLog(`--- retry ${attempt}/${MAX_ATTEMPTS} ---`)
    let recent = ""
    const proc = spawn("qwenaudio", buildGatewayArgs(), { env, stdio: ["ignore", "pipe", "pipe"] })
    child = proc
    const tap = (d: unknown, warn = false) => {
      const text = String(d)
      recent = `${recent}${text}`.slice(-4000)
      if (warn) log.warn(`[voice-gateway] ${text.trimEnd()}`)
      else log.info(`[voice-gateway] ${text.trimEnd()}`)
      appendVoiceLog(text)
    }
    proc.stdout?.on("data", (d) => tap(d))
    proc.stderr?.on("data", (d) => tap(d, true))
    proc.on("error", (e) => {
      lastError = `语音网关起不来:${e.message}`
      if (child === proc) child = null
    })
    proc.on("exit", (code, signal) => {
      log.info(`[voice] gateway exited code=${code} signal=${signal}`)
      appendVoiceLog(`--- exit code=${code} signal=${signal} ---`)
      if (child === proc) {
        healthy = false
        child = null
        // 非我们主动停的退出要留痕,否则图标会莫名其妙变回"关"
        if (code !== 0 && code !== null) lastError = `语音网关意外退出(code=${code})`
      }
    })

    healthy = await waitForHealth(60_000, () => isRetryableStartFailure(recent))
    appendVoiceLog(`attempt=${attempt} health=${healthy}`)
    if (healthy) {
      lastError = ""
      break
    }
    // 没起来:**必须等这一轮真的退干净**再决定重试。
    // 2026-08-21 真机:只发 SIGTERM + 固定睡 3 秒就重来,实测退出用了 3.1 秒 —— 新一轮
    // 早了 100ms 起来,3101 端口和 gateway 实例租约还被上一轮占着,第 2 轮秒退,
    // 白白烧掉一次重试机会。
    child = null
    await terminate(proc)
    if (!isRetryableStartFailure(recent)) {
      if (!lastError) lastError = "语音网关启动超时 —— 日志见 voice-gateway.log"
      break
    }
    lastError = `语音后端首次初始化没抢过并发(建表/锁冲突),已重试 ${attempt}/${MAX_ATTEMPTS} 次`
  }

  starting = false
  if (healthy) startSessionListWatch(ws.dir)
  if (healthy && input.openUi !== false) {
    // Gateway 是无头的:不打开前端,用户点完图标面对的是"什么也没发生"。
    // 它的根路径就是 WebUI(实测 200 / text/html),交给系统浏览器 —— 麦克风授权那套
    // 浏览器已经处理好了,比在 Electron 里自己搭一套权限流省事得多(自用阶段够用)。
    const url = `http://127.0.0.1:${GATEWAY_PORT}/`
    void shell.openExternal(url).catch((e) => log.warn(`[voice] 打开语音界面失败 ${url}: ${String(e)}`))
  }
  return getVoiceStatus(input.workspace)
}

/**
 * 让一个子进程真正结束:先 SIGTERM,`graceMs` 内不走就 SIGKILL。
 * 返回时进程一定已经 exit(或从来就没起来),端口 / 实例租约才算真的还回来了。
 */
async function terminate(proc: ChildProcess, graceMs = 8000): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()))
  try {
    proc.kill("SIGTERM")
  } catch {
    return
  }
  const timer = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), graceMs))
  if ((await Promise.race([exited.then(() => "exited" as const), timer])) === "timeout") {
    try {
      proc.kill("SIGKILL")
    } catch {}
    await Promise.race([exited, new Promise<void>((r) => setTimeout(r, 2000))])
  }
}

/**
 * 轮询到"gateway + 后端都就绪"为止。
 * `giveUp` 让调用方拿进程输出提前叫停 —— 后端建表撞车时 3101 会一直 200,
 * 干等满超时才认输 = 用户白等一分钟,而重试其实立刻就能成。
 */
async function waitForHealth(timeoutMs = 60_000, giveUp?: () => boolean): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!child) return false
    if (giveUp?.()) return false
    try {
      const res = await fetch(gatewayHealthUrl(), { signal: AbortSignal.timeout(3000) })
      if (res.ok && isBackendReady(await res.json())) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

export async function stopVoiceGateway(): Promise<VoiceStatus> {
  const proc = child
  child = null
  starting = false
  healthy = false
  lastError = ""
  taskWatch?.stop()
  taskWatch = null
  journalState = null
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
