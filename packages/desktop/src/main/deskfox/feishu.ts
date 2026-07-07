// FORK-ONLY: DeskFox 飞书桥接 IPC 转发 [feat: electron-replatform] 2026-06-12
//
// 从 Tauri feishu_adapter.rs 平移。renderer 经 window.deskfox.invoke("feishu_*") 调,本模块:
//   1. lazy 读 ~/.opencode/feishu-plugin-server.json(飞书插件启动后写入 url/username/password)
//   2. renderer 的 snake_case 请求 → 插件 server 的 camelCase wire
//   3. HTTP POST/GET(Basic auth)转发到插件 server
//   4. 插件 camelCase 响应 → renderer 期望的 snake_case
// 字段命名:renderer/feishu-config.ts 是契约源(snake_case);插件 server.ts 是 camelCase。
// feishu_pick_workspace_dir 走 Electron dialog(原 Tauri dialog 插件)。

import fs from "fs"
import os from "os"
import path from "path"
import { dialog, BrowserWindow } from "electron"

type Ready = { url: string; username: string; password: string }

// REQ-029:plugin 看门狗重启会换端口重写 server.json,缓存必须随 mtime 失效,
// 否则永远打旧端口 connect refused。statSync 每次调用一趟,本地开销可忽略。
// 同毫秒双写理论上漏检,真实重启间隔远大于 mtime 精度,不处理。
let cached: Ready | null = null
let cachedMtimeMs = 0

export function loadReadyFrom(file: string): Ready | null {
  try {
    const mtimeMs = fs.statSync(file).mtimeMs
    if (cached && mtimeMs === cachedMtimeMs) return cached
    const r = JSON.parse(fs.readFileSync(file, "utf-8")) as Ready
    if (r?.url && r?.username) {
      cached = r
      cachedMtimeMs = mtimeMs
      return r
    }
    cached = null
    cachedMtimeMs = 0
  } catch {
    /* 插件还没启动(文件不存在)/ 内容损坏 → 清缓存,不残留旧端口 */
    cached = null
    cachedMtimeMs = 0
  }
  return null
}

export function resetReadyCacheForTest() {
  cached = null
  cachedMtimeMs = 0
}

function loadReady(): Ready | null {
  return loadReadyFrom(path.join(os.homedir(), ".opencode", "feishu-plugin-server.json"))
}

function currentReady(): Ready {
  const r = loadReady()
  if (!r) {
    throw new Error(
      "adapter not ready: 飞书桥接 plugin 还未启动 — 检查 ~/.config/opencode/opencode.jsonc 是否注册了 plugin,且 opencode 边车已启动",
    )
  }
  return r
}

function authHeader(r: Ready): string {
  return "Basic " + Buffer.from(`${r.username}:${r.password}`).toString("base64")
}

async function postJson<T>(path_: string, body: unknown): Promise<T> {
  const r = currentReady()
  const res = await fetch(`${r.url}${path_}`, {
    method: "POST",
    headers: { Authorization: authHeader(r), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`adapter HTTP ${res.status}: ${text}`)
  return JSON.parse(text) as T
}

async function getJson<T>(path_: string): Promise<T> {
  const r = currentReady()
  const res = await fetch(`${r.url}${path_}`, {
    headers: { Authorization: authHeader(r) },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`adapter HTTP ${res.status}: ${text}`)
  return JSON.parse(text) as T
}

// ── camelCase wire ↔ snake_case renderer 映射 ──

/** model {provider_id, model_id} → wire {providerID, modelID};null/undefined 原样 */
function modelToWire(m: { provider_id: string; model_id: string } | null | undefined) {
  return m ? { providerID: m.provider_id, modelID: m.model_id } : m ?? null
}
function modelFromWire(m: { providerID: string; modelID: string } | null | undefined) {
  return m ? { provider_id: m.providerID, model_id: m.modelID } : null
}

type AccountWire = {
  accountId: string
  appId: string
  openId: string
  domain: string
  agent: string
  enabled?: boolean | null
  model?: { providerID: string; modelID: string } | null
  botName?: string | null
  requireMention?: boolean | null
  workspace?: string | null
  workspaceEffective?: string | null
}

function accountFromWire(w: AccountWire) {
  return {
    account_id: w.accountId,
    app_id: w.appId,
    open_id: w.openId,
    domain: w.domain,
    agent: w.agent,
    enabled: w.enabled ?? null,
    model: modelFromWire(w.model),
    bot_name: w.botName ?? null,
    require_mention: w.requireMention ?? null,
    workspace: w.workspace ?? null,
    workspace_effective: w.workspaceEffective ?? null,
  }
}

// ============================================================
// IPC 命令(对应 renderer feishu-config.ts 的 invoke)
// ============================================================

export function feishuAdapterStatus(): boolean {
  return loadReady() !== null
}

export async function feishuOauthStart(args: { request: { domain: string } }) {
  const w = await postJson<{
    sessionId: string
    deviceCode: string
    userCode: string
    verificationUri: string
    verificationUriComplete: string
    expiresIn: number
    interval: number
  }>("/oauth/start", { domain: args.request.domain })
  return {
    session_id: w.sessionId,
    device_code: w.deviceCode,
    user_code: w.userCode,
    verification_uri: w.verificationUri,
    verification_uri_complete: w.verificationUriComplete,
    expires_in: w.expiresIn,
    interval: w.interval,
  }
}

export async function feishuOauthPoll(args: { request: { session_id: string } }) {
  const w = await postJson<{
    status: string
    appId?: string
    appSecret?: string
    openId?: string
    accessToken?: string
    refreshToken?: string
    expiresIn?: number
    message?: string
    code?: string
    nextIntervalMs?: number
  }>("/oauth/poll", { sessionId: args.request.session_id })
  return {
    status: w.status,
    app_id: w.appId,
    app_secret: w.appSecret,
    open_id: w.openId,
    access_token: w.accessToken,
    refresh_token: w.refreshToken,
    expires_in: w.expiresIn,
    message: w.message,
    code: w.code,
    next_interval_ms: w.nextIntervalMs,
  }
}

export async function feishuSaveAccount(args: {
  request: { domain: string; app_id: string; app_secret: string; open_id: string; account_id?: string }
}) {
  const req = args.request
  const w = await postJson<AccountWire>("/accounts/save", {
    domain: req.domain,
    appId: req.app_id,
    appSecret: req.app_secret,
    openId: req.open_id,
    ...(req.account_id ? { accountId: req.account_id } : {}),
  })
  // save 返回不含 enabled/model/require_mention/workspace 生效值 → 默认值(GUI 随后 refetch 列表拿真值)
  return {
    ...accountFromWire(w),
    enabled: null,
    model: null,
    require_mention: true, // 新绑账号默认 requireMention=true
    workspace: null,
    workspace_effective: null,
  }
}

export async function feishuListAccounts() {
  const w = await getJson<{ accounts: AccountWire[] }>("/accounts")
  return w.accounts.map(accountFromWire)
}

export async function feishuDeleteAccount(args: { request: { account_id: string } }) {
  const w = await postJson<{ deleted: boolean }>("/accounts/delete", { accountId: args.request.account_id })
  return w.deleted
}

export async function feishuUpdateAccountModel(args: {
  request: { account_id: string; model: { provider_id: string; model_id: string } | null }
}) {
  const w = await postJson<{ updated: boolean }>("/accounts/update-model", {
    accountId: args.request.account_id,
    model: modelToWire(args.request.model),
  })
  return w.updated
}

export async function feishuUpdateAccountSettings(args: {
  request: {
    account_id: string
    model?: { provider_id: string; model_id: string } | null
    require_mention?: boolean
    workspace?: string
  }
}) {
  const req = args.request
  // Option<Option> 编码:model 键存在(null 或 object)= 改;不存在 = 不动
  const wire: Record<string, unknown> = { accountId: req.account_id }
  if ("model" in req) wire.model = modelToWire(req.model)
  if (req.require_mention !== undefined) wire.requireMention = req.require_mention
  if (req.workspace !== undefined) wire.workspace = req.workspace
  const w = await postJson<{ updated: boolean }>("/accounts/update-settings", wire)
  return w.updated
}

export async function feishuPickWorkspaceDir(): Promise<string | null> {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
  const res = await dialog.showOpenDialog(parent!, {
    title: "选择该飞书账号的工作目录(项目文件夹)",
    defaultPath: os.homedir(),
    properties: ["openDirectory", "createDirectory"],
  })
  if (res.canceled || res.filePaths.length === 0) return null
  return res.filePaths[0]
}

export async function feishuListProviders(): Promise<string> {
  const w = await getJson<{ data: unknown }>("/providers")
  return JSON.stringify(w.data)
}
