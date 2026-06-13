// FORK-ONLY: DeskFox 匿名使用统计客户端(Electron 主进程)
//   [feat: telemetry-usage-stats / electron-replatform] 2026-06-13
//
// 从 Tauri `src-tauri/src/telemetry.rs` 平移到 Node。主力前端是 WebView,统计逻辑留在主进程
// (与 updater 同层),3 个 IPC 命令(get/set/track)暴露给 renderer 经 window.deskfox 桥。
//
// 数据安全前提下的最小采集:
//   - 事件:app_open / update_downloaded / update_applied
//   - 字段:version / os(大类)/ arch(大类)/ install_id(匿名 UUID)
//   - 绝不采集:文件路径 / prompt / 模型名 / 用户身份 / 原始 IP(IP 仅后端推断地理后即丢)
// opt-out 优先级:env OPENCODE_TELEMETRY=0 > config telemetry:false > 默认开。上报失败一律静默。

import fs from "fs"
import os from "os"
import path from "path"
import crypto from "crypto"
import { parse as parseJsonc } from "jsonc-parser"

/** 事件白名单 —— 任何不在此列的事件名一律丢弃(前端 command 也受此约束)。 */
const ALLOWED_EVENTS = ["app_open", "update_downloaded", "update_applied"] as const

/** Plausible 事件上报端点(后端在东京机)。 */
const TELEMETRY_ENDPOINT = "https://telemetry.deskfox.ai/api/event"
/** 上报超时(ms),fire-and-forget,不重试。 */
const REQUEST_TIMEOUT_MS = 5000

// 模块状态:启动时由 index.ts initTelemetry() 注入(version + bundle identifier)。
let appVersion = "0.0.0"
let appIdentifier = "ai.deskfox.app.dev"

export function initTelemetry(info: { version: string; identifier: string }): void {
  appVersion = info.version
  appIdentifier = info.identifier
}

/** 按 channel 选 Plausible site —— 防 dev/beta 流量污染 prod。未知 identifier 一律归 dev(fail-safe)。 */
function domainForIdentifier(identifier: string): string {
  switch (identifier) {
    case "ai.deskfox.app":
      return "opencode.desktop"
    case "ai.deskfox.app.beta":
      return "opencode.desktop-beta"
    default:
      return "opencode.desktop-dev"
  }
}

// ── 路径解析(OPENCODE_TEST_HOME 可注入以便单测,对齐 Rust)──
function homeBase(): string {
  return process.env.OPENCODE_TEST_HOME || os.homedir()
}
function cacheDir(): string {
  return path.join(homeBase(), ".cache", "opencode")
}
function configDir(): string {
  // 注:Win 上 opencode 配置也在 ~/.config/opencode(非 %APPDATA%),对齐 Rust home_base+.config
  return path.join(homeBase(), ".config", "opencode")
}
function configPath(): string {
  return path.join(configDir(), "config.json")
}

// ── install_id —— 本地随机匿名 UUID,首次生成落盘,后续复用 ──
export function getOrCreateInstallId(): string {
  return getOrCreateInstallIdIn(cacheDir())
}
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}
export function getOrCreateInstallIdIn(dir: string | null): string {
  if (!dir) return "unknown"
  const file = path.join(dir, "install_id")
  try {
    const existing = fs.readFileSync(file, "utf-8").trim()
    // 校验合法 UUID;脏值(云同步/控制字符)丢弃重生成 —— 否则流进 payload / UA header 致永久静默失效。
    if (isUuid(existing)) return existing
  } catch {
    // 文件不存在 / 读失败 → 往下生成
  }
  const id = crypto.randomUUID()
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, id)
    // 收紧 0600(类 Unix):匿名设备 ID 不被同机其他用户读到。Windows 用户目录默认私有,chmod no-op。
    if (process.platform !== "win32") fs.chmodSync(file, 0o600)
  } catch {
    // 写失败也返回本次生成的 id(不抛、不阻塞)
  }
  return id
}
function shortId(id: string): string {
  return id.slice(0, 8)
}

// ── opt-out 判定(env > config > 默认 true)──
function parseEnvTelemetry(raw: string): boolean | undefined {
  switch (raw.trim().toLowerCase()) {
    case "0":
    case "false":
    case "no":
    case "off":
      return false
    case "1":
    case "true":
    case "yes":
    case "on":
      return true
    default:
      return undefined
  }
}
/** 纯函数:env 值与 config 值按优先级判定。可单测。 */
export function resolveEnabled(envVal: string | undefined, configVal: boolean | undefined): boolean {
  if (envVal !== undefined) {
    const parsed = parseEnvTelemetry(envVal)
    if (parsed !== undefined) return parsed
  }
  return configVal ?? true
}
/** 纯函数:从配置文本取顶层 telemetry 布尔。用 jsonc 解析兼容注释/尾逗号(否则 opt-out 失灵)。 */
export function parseTelemetryField(raw: string): boolean | undefined {
  try {
    const errors: unknown[] = []
    const json = parseJsonc(raw, errors as never[], { allowTrailingComma: true })
    if (json && typeof json === "object" && typeof (json as Record<string, unknown>).telemetry === "boolean") {
      return (json as Record<string, boolean>).telemetry
    }
  } catch {
    // 解析失败跳过(降级)
  }
  return undefined
}
/** 按 opencode 合并优先级逐文件读(config.json < opencode.json < opencode.jsonc),返回最后命中。 */
function readConfigTelemetry(): boolean | undefined {
  const dir = configDir()
  let value: boolean | undefined
  for (const file of ["config.json", "opencode.json", "opencode.jsonc"]) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8")
      const b = parseTelemetryField(raw)
      if (b !== undefined) value = b
    } catch {
      // 文件缺失/读失败跳过
    }
  }
  return value
}
export function isEnabled(): boolean {
  return resolveEnabled(process.env.OPENCODE_TELEMETRY, readConfigTelemetry())
}
/** 有效值是否被 config.json 之外来源(env / opencode.json / opencode.jsonc)决定 → UI 写 config 改不动 → 锁。 */
function isLocked(): boolean {
  const env = process.env.OPENCODE_TELEMETRY
  if (env !== undefined && parseEnvTelemetry(env) !== undefined) return true
  const dir = configDir()
  for (const file of ["opencode.json", "opencode.jsonc"]) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), "utf-8")
      if (parseTelemetryField(raw) !== undefined) return true
    } catch {
      // 跳过
    }
  }
  return false
}

// ── 字段大类(os/arch 粗粒度,对齐 Rust std consts 的字符串以保持 Plausible 历史数据一致)──
export function osClass(): string {
  switch (process.platform) {
    case "darwin":
      return "macos"
    case "win32":
      return "windows"
    case "linux":
      return "linux"
    default:
      return process.platform
  }
}
export function archClass(): string {
  switch (process.arch) {
    case "arm64":
      return "aarch64"
    case "x64":
      return "x86_64"
    case "ia32":
      return "x86"
    default:
      return process.arch
  }
}

// ── 事件 body 构造(Plausible /api/event 格式)──
/** 纯函数:构造上报 JSON body。app_open→pageview(计 DAU),update_*→自定义事件。可单测。 */
export function buildEventBody(event: string, domain: string, version: string, installId: string): string {
  const [name, url] = event === "app_open" ? ["pageview", "app://launch"] : [event, "app://event"]
  return JSON.stringify({
    name,
    url,
    domain,
    props: { version, install_id: installId, os: osClass(), arch: archClass() },
  })
}
export function userAgent(version: string, installId: string): string {
  return `opencode-desktop/${version} (${osClass()}; ${archClass()}; install=${shortId(installId)})`
}

// ── 上报(fire-and-forget,静默失败)──
function isAllowedEvent(name: string): boolean {
  return (ALLOWED_EVENTS as readonly string[]).includes(name)
}
function prepareEvent(name: string): { body: string; ua: string } | null {
  if (!isAllowedEvent(name) || !isEnabled()) return null
  const installId = getOrCreateInstallId()
  const domain = domainForIdentifier(appIdentifier)
  return { body: buildEventBody(name, domain, appVersion, installId), ua: userAgent(appVersion, installId) }
}
async function sendEvent(body: string, ua: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    await fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": ua },
      body,
      signal: controller.signal,
    })
  } catch {
    // 成功/失败/超时都静默
  } finally {
    clearTimeout(timer)
  }
}

/** fire-and-forget:非白名单事件廉价短路;否则后台发,不阻塞调用方。 */
export function track(name: string): void {
  if (!isAllowedEvent(name)) return
  const prepared = prepareEvent(name)
  if (prepared) void sendEvent(prepared.body, prepared.ua)
}
/** 阻塞版:等发送完成(受超时上限)再返回 —— 给 relaunch 前的 update_applied 用,防进程重启杀掉请求。 */
export async function trackBlocking(name: string): Promise<void> {
  const prepared = prepareEvent(name)
  if (prepared) await sendEvent(prepared.body, prepared.ua)
}
/** 启动时调:发 app_open(pageview)注册当日活跃。 */
export function emitAppOpen(): void {
  track("app_open")
}

// ── 设置开关读写(config.json telemetry 字段,UI 设置→通用 绑定)──
export type TelemetryStatus = { enabled: boolean; locked: boolean }
/** 读统计开关状态(给 UI):enabled=有效值;locked=被 config.json 之外来源锁定(开关应禁用+提示)。 */
export function getTelemetryStatus(): TelemetryStatus {
  return { enabled: isEnabled(), locked: isLocked() }
}
/** 写 config.json 的 telemetry 字段(保留其余字段,原子写)。失败抛错让前端可提示。 */
export function setTelemetryEnabledIn(file: string | null, enabled: boolean): void {
  if (!file) return
  let json: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>
  } catch {
    // 不存在/坏 → 用空对象起
  }
  json.telemetry = enabled
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  // 原子写:写同目录临时文件(带 pid)→ rename 覆盖,避免并发/半截写截断共用 config.json。
  const tmp = path.join(dir, `${path.basename(file)}.tmp${process.pid}`)
  fs.writeFileSync(tmp, JSON.stringify(json, null, 2) + "\n")
  try {
    fs.renameSync(tmp, file)
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // ignore cleanup failure
    }
    throw e
  }
}
export function setTelemetryEnabled(enabled: boolean): void {
  setTelemetryEnabledIn(configPath(), enabled)
}

// ── IPC 入口(deskfox/ipc.ts 注册)──
/** track_event_cmd:前端上报入口,name 受白名单约束;blocking 给 update_applied 用。 */
export async function trackEventCmd(args: { name: string; blocking?: boolean }): Promise<void> {
  if (args.blocking) await trackBlocking(args.name)
  else track(args.name)
}
