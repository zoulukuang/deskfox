// [fork-only] REQ-102 语音派活 — 从 ACP 帧里捞出动态注册的 MCP server [feat: voice-dispatch-minimal] 2026-08-21
//
// 为什么需要它:`claude-code` provider 会 spawn `claude` CLI,而 CLI 只认自己那套 MCP。
// plugin 侧(deskfox-plugins/claude-code)已经能把 **opencode 配置文件里声明的** MCP 透传给 CLI,
// 但 qwen 的第三层 Session 工具(`session_start` / `session_send` / …)是**运行时**通过
// ACP `session/new` / `session/resume` 的 `mcpServers` 动态注册的 —— 只存在于 opencode 进程内存里,
// 配置文件读不到,plugin 也就拿不到。结果:切回 claude-code 就没有第三层。
//
// 本来要改 `packages/opencode/src/session/llm.ts` 开一条 providerOptions 通道(黑名单 → 一笔 R4)。
// 但其实不必:**wrapper 就夹在 qwen 和宿主中间,所有带 mcpServers 的帧都从它手里过**。
// 在那里旁路抄一份写到文件,再用 env 把路径告诉宿主进程里的 plugin,就零上游改动拿到了同样的东西。
//
// ⚠️ 只观察不加工:wrapper 对 stdin 方向的契约是原样透传(ACP 是双向 ndJSON,加工了必出错),
// 所以调用方必须**先转发再解析**,解析失败一律吞掉。

/** ACP 帧里 `mcpServers` 元素的两种形态(与 `@agentclientprotocol/sdk` 的 McpServer 对齐) */
export type AcpMcpServer =
  | { readonly type: string; readonly name: string; readonly url: string; readonly headers?: readonly { name: string; value: string }[] }
  | { readonly name: string; readonly command: string; readonly args?: readonly string[]; readonly env?: readonly { name: string; value: string }[] }

/**
 * 从一行 ACP 帧里抽出 `mcpServers`。不是目标帧就返回 null。
 *
 * 只认 `session/new` 与 `session/resume` —— 这两个方法的 params 才带 mcpServers
 * (2026-08-21 tee 抓帧确认:复用 coordinator 时走的是 resume,首次才是 new)。
 */
export function extractMcpServers(line: string): readonly AcpMcpServer[] | null {
  let msg: unknown
  try {
    msg = JSON.parse(line)
  } catch {
    return null
  }
  if (!msg || typeof msg !== "object") return null
  const m = msg as { method?: unknown; params?: { mcpServers?: unknown } }
  if (m.method !== "session/new" && m.method !== "session/resume") return null
  const list = m.params?.mcpServers
  if (!Array.isArray(list) || list.length === 0) return null
  return list.filter((x) => x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string")
}

/**
 * 把 ACP 形态转成 plugin 认识的形态(headers/env 由 `{name,value}[]` 拍平成对象)。
 *
 * 保持 `type` 原样(`http` / `sse`),由 plugin 决定怎么喂给 CLI —— 这里只做结构转换,
 * 不替下游做语义决定,免得两边各判各的。
 */
export function normalizeMcpServers(servers: readonly AcpMcpServer[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  const pairsToObject = (pairs: readonly { name: string; value: string }[] | undefined) => {
    if (!Array.isArray(pairs) || pairs.length === 0) return undefined
    const o: Record<string, string> = {}
    for (const p of pairs) if (p && typeof p.name === "string") o[p.name] = String(p.value ?? "")
    return Object.keys(o).length > 0 ? o : undefined
  }
  for (const s of servers) {
    if ("url" in s && s.url) {
      const headers = pairsToObject(s.headers)
      out[s.name] = { type: String(s.type ?? "http"), url: s.url, ...(headers ? { headers } : {}) }
      continue
    }
    if ("command" in s && s.command) {
      const env = pairsToObject(s.env)
      const args = Array.isArray(s.args) ? s.args.filter((a) => typeof a === "string") : []
      out[s.name] = { command: s.command, ...(args.length > 0 ? { args } : {}), ...(env ? { env } : {}) }
    }
  }
  return out
}

/**
 * 这一批和上一批比有没有实质变化(避免每帧都写盘)。
 * **token 变了也算变** —— qwen 每次 register 生成新 token,写旧的等于给 CLI 一把过期钥匙。
 */
export function mcpSnapshotChanged(previous: string, next: Record<string, Record<string, unknown>>): boolean {
  return previous !== JSON.stringify(next)
}
