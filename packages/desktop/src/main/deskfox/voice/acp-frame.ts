// [fork-only] REQ-102 语音派活 — ACP ndJSON 帧判定与切行 [feat: voice-dispatch-minimal] 2026-08-21
//
// D-E:stdout 净化走**管道级**而不是进程内。理由(实测,非推断):
//   Bun 下 patch `process.stdout.write` **拦不到 `console.log`**(bun 拦截计数 0 / node 1),
//   而 ACP 宿主跑在 bun 上 —— 进程内守卫压根挡不住插件的 52 处 console.log 和 lark SDK 自己的
//   logger。管道级则源无关:子进程无论用什么姿势写 fd 1(console / process.stdout / native),
//   到了父进程这儿都是同一条字节流,一视同仁地过滤。
//
// 这里只放纯逻辑,spawn 与 wiring 在 `packages/desktop/scripts/deskfox-acp-wrap.mjs`。

/**
 * 是不是 ACP 协议帧。判据**故意比"能 JSON.parse"更严**:
 * 插件日志里以 `{` 开头的行(打印对象、JSON 配置)是真实存在的 —— REQ-102 §3.5 就写了
 * 「任何一行插件输出恰好以 `{` 开头就会炸」。只放行带 `jsonrpc: "2.0"` 的对象,才是真的收口。
 */
export function isAcpFrame(line: string): boolean {
  const s = line.trim()
  // 快速排除:非 { 开头的一律不是(省掉绝大多数噪声行的 JSON.parse 开销)
  if (!s.startsWith("{")) return false
  try {
    const o = JSON.parse(s) as unknown
    return !!o && typeof o === "object" && (o as { jsonrpc?: unknown }).jsonrpc === "2.0"
  } catch {
    return false
  }
}

export interface LineSplitter {
  /** 喂一段(可能半行的)文本,返回本次凑齐的完整行(不含换行符) */
  push(chunk: string): string[]
  /** 流结束时把残留的半行吐出来(可能为空) */
  flush(): string[]
}

/**
 * 按行切分,**必须**能扛住两件事,否则 ACP 直接坏:
 *   ① 跨 chunk 的半行 —— 一个 ndJSON 帧可能被 TCP/管道切成好几段;
 *   ② 超大帧 —— session/prompt 的响应可以很大,不许截断。
 * 所以这里只做拼接与切分,不设长度上限。空行丢弃(既不是帧也不是有价值的噪声)。
 */
export function createLineSplitter(): LineSplitter {
  let buf = ""
  return {
    push(chunk: string): string[] {
      buf += chunk
      if (!buf.includes("\n")) return []
      const parts = buf.split("\n")
      buf = parts.pop() ?? ""
      return parts.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l)).filter((l) => l.length > 0)
    },
    flush(): string[] {
      const rest = buf
      buf = ""
      const line = rest.endsWith("\r") ? rest.slice(0, -1) : rest
      return line.length > 0 ? [line] : []
    },
  }
}

export interface PartitionResult {
  readonly frames: readonly string[]
  readonly noise: readonly string[]
}

/** 把一批行分成「协议帧」和「噪声」两拨。 */
export function partitionLines(lines: readonly string[]): PartitionResult {
  const frames: string[] = []
  const noise: string[] = []
  for (const l of lines) (isAcpFrame(l) ? frames : noise).push(l)
  return { frames, noise }
}
