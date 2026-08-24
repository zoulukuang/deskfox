// [fork-only] voice-acp-bridge — qwen 的 ACP MCP 描述符 → sidecar mcp 配置 [feat: voice-acp-bridge] 2026-08-24
//
// qwen 在 `session/new` / `session/resume` 里下发一批 MCP server 描述符,桥要把它们转译成
// sidecar 的 `POST /mcp` 配置,coordinator 才拿得到那五个派活工具。两边形状差得不小:
//
//   qwen(ACP McpServer)                     sidecar(ConfigMCPV1)
//   ─────────────────────────────────────    ────────────────────────────────
//   { type:"http", name, url,                { type:"remote", url,
//     headers:[{name,value}] }                 headers:{ [name]: value } }     ← 数组 → 对象
//   { name, command, args,                   { type:"local",
//     env:[{name,value}] }   ← 无 type         command:[command, ...args],     ← 拆成一个数组
//                                              environment:{ [name]: value } }
//
// ⚠️ **注册的作用域是 directory,不是 session**(`mcp/index.ts` 的 `InstanceState` 按 directory 取缓存)。
// 这一条决定了本文件的策略:注册进某个目录 = 该目录下**所有** session 都会多出这些工具,
// 包括用户自己手敲的那些。所以第三层任务目录(= 用户真实项目)**一律不注册** ——
// 否则用户打开自己的项目会莫名其妙看到 qwen 的派活工具,更糟的是第三层拿到 `session_start`
// 就等于递归防护(1-spec §3.1)当场失效。

import { QWEN_MCP_SERVER_NAME } from "./contract"

/** sidecar `POST /mcp` 的 body(`packages/core/src/v1/config/mcp.ts:6-59`)。 */
export type SidecarMcpConfig =
  | { readonly type: "remote"; readonly url: string; readonly headers?: Record<string, string>; readonly enabled: true }
  | {
      readonly type: "local"
      readonly command: readonly string[]
      readonly environment?: Record<string, string>
      readonly enabled: true
    }

export interface SidecarMcpRegistration {
  readonly name: string
  readonly config: SidecarMcpConfig
}

/** qwen 的 `[{name, value}]` 形态转成对象。重名后来者胜(与 HTTP 头的常规语义一致)。 */
export function pairsToRecord(pairs: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(pairs)) return out
  for (const p of pairs) {
    if (!p || typeof p !== "object") continue
    const { name, value } = p as { name?: unknown; value?: unknown }
    if (typeof name === "string" && name.length > 0 && typeof value === "string") out[name] = value
  }
  return out
}

/**
 * 单个描述符的转译。认不出形状返回 null(不猜)——
 * qwen 升级加了新传输类型时,我们宁可少注册一个工具,也不要拿错误配置去污染用户目录。
 */
export function translateMcpServer(server: unknown): SidecarMcpRegistration | null {
  if (!server || typeof server !== "object") return null
  const s = server as {
    type?: unknown
    name?: unknown
    url?: unknown
    headers?: unknown
    command?: unknown
    args?: unknown
    env?: unknown
  }
  const name = typeof s.name === "string" ? s.name.trim() : ""
  if (!name) return null

  // http 型:qwen 的 Session 工具服务器就是这个形态(`acp-session-tools.mjs:184-192`)
  if (s.type === "http" || s.type === "sse") {
    if (typeof s.url !== "string" || !s.url) return null
    const headers = pairsToRecord(s.headers)
    return {
      name,
      config: { type: "remote", url: s.url, ...(Object.keys(headers).length ? { headers } : {}), enabled: true },
    }
  }

  // stdio 型:**没有 type 字段**(它是 union 的裸分支),靠 command 认
  if (typeof s.command === "string" && s.command) {
    const args = Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === "string") : []
    const environment = pairsToRecord(s.env)
    return {
      name,
      config: {
        type: "local",
        command: [s.command, ...args],
        ...(Object.keys(environment).length ? { environment } : {}),
        enabled: true,
      },
    }
  }
  return null
}

export interface McpPlan {
  /** 真要注册进 sidecar 的 */
  readonly register: readonly SidecarMcpRegistration[]
  /** 认出来了但按策略跳过的,连同理由 —— 进日志,免得下次排查"工具怎么没了"从零查起 */
  readonly skipped: readonly { readonly name: string; readonly reason: string }[]
}

/**
 * 决定这批描述符要往 sidecar 注册哪些。
 *
 * @param coordinator 本条 session 是不是 coordinator。**只有 coordinator 才注册**,理由见文件头。
 */
export function planMcpRegistrations(servers: unknown, coordinator: boolean): McpPlan {
  const register: SidecarMcpRegistration[] = []
  const skipped: { name: string; reason: string }[] = []
  const list = Array.isArray(servers) ? servers : []
  for (const raw of list) {
    const translated = translateMcpServer(raw)
    if (!translated) {
      const name = (raw as { name?: unknown })?.name
      skipped.push({ name: typeof name === "string" ? name : "(无名)", reason: "认不出的 MCP 传输形态,跳过" })
      continue
    }
    if (!coordinator) {
      skipped.push({
        name: translated.name,
        reason: "非 coordinator session —— 注册会波及该目录下用户自己的会话,且会让第三层拿到派活工具",
      })
      continue
    }
    // coordinator 目录里也只放 qwen 的派活工具。builtin(open-computer-use 之类)对我们没用:
    // 第三层是 DeskFox 自己的 session,本来就有全套读写/执行工具(1-spec R8)。
    if (translated.name !== QWEN_MCP_SERVER_NAME) {
      skipped.push({ name: translated.name, reason: "非派活工具,DeskFox session 自带全套工具,无需引入" })
      continue
    }
    register.push(translated)
  }
  return { register, skipped }
}

/**
 * 这批描述符里有没有 qwen 的派活工具 —— **判定「这条 session/new 是不是 coordinator」的结构性判据**。
 *
 * 为什么用它而不是看 prompt 内容:`session/new` 发生在任何 prompt 之前,那时还没有文本可判;
 * 而 qwen 只把 Session 工具注册给 coordinator(`acp-backend-adapter.mjs:1018-1026` vs `:808`/`:863`),
 * 第三层永远只有 builtin。这个差别是结构性的,比任何字符串匹配都稳。
 */
export function looksLikeCoordinator(servers: unknown): boolean {
  const list = Array.isArray(servers) ? servers : []
  return list.some((s) => {
    const name = (s as { name?: unknown })?.name
    return typeof name === "string" && name === QWEN_MCP_SERVER_NAME
  })
}
