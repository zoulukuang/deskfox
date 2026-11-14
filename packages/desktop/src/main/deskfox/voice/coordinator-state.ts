// [fork-only] REQ-102 语音派活 — 换后端模型时作废 qwen 的 coordinator session [feat: voice-dispatch-minimal] 2026-08-21
//
// 起因(2026-08-21 真机,花了很久才定位):改了 `OPENCODE_CONFIG_CONTENT.model` 却**完全不生效**,
// 打点显示实际跑的还是老模型。根因不在我们这边 ——
//   · qwen 把 coordinator 的 sessionId 持久化在 `$XDG_CONFIG_HOME/qwaudio/state/acp-sessions.json`,
//     跨 gateway 重启复用(`AcpSessionRegistry`);
//   · 复用走的是 ACP `session/resume`,而 opencode 的 `resumeSession` 是
//     `restoreFromMessages(messages).model ?? selectDefaultModel(...)` —— **优先从历史消息恢复模型**,
//     配置里的 model 根本轮不到。
// 于是"换模型"这个动作在有旧 session 的机器上是**静默失效**的,连日志都不会报。
//
// 对策:我们自己记住"上次用哪个 backend model 起的",不一致就把 qwen 那条 coordinator 记录删掉,
// 逼它 `session/new` 建新的 —— 新 session 才会读配置里的 model。
//
// 为什么删得起:coordinator 在 C 方案里就是个**路由器**(判断该新建第三层 session 还是续接哪条),
// 真正的工作上下文都在第三层 project session 里,不在它身上。丢掉它的历史没有实际损失。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

/** qwen 存 ACP session 状态的地方(`AcpSessionRegistry` 的 filePath) */
export function acpSessionStatePath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const configHome = env.XDG_CONFIG_HOME || path.join(home, ".config")
  return path.join(configHome, "qwaudio", "state", "acp-sessions.json")
}

/** 我们自己的"上次用了哪个模型"备忘;跟 qwen 的状态分开放,别去写它的文件 */
export function voiceModelStampPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const stateHome = env.XDG_STATE_HOME || path.join(home, ".local", "state")
  return path.join(stateHome, "deskfox", "voice-backend-model")
}

/**
 * 从 qwen 的状态里摘掉 opencode 的 coordinator 记录。**纯函数**,只负责改 JSON 结构。
 *
 * key 形如 `opencode:user_personal:backend`(`coordinatorKey(ownerId, protocol)` 拼的),
 * 所以按 `opencode:` 前缀匹配 —— 别的 backend(claude / openclaw / …)的记录不该被殃及。
 */
export function dropOpencodeCoordinators(state: unknown): { next: unknown; dropped: readonly string[] } {
  if (!state || typeof state !== "object") return { next: state, dropped: [] }
  const s = state as { coordinators?: Record<string, unknown> }
  const coordinators = s.coordinators
  if (!coordinators || typeof coordinators !== "object") return { next: state, dropped: [] }
  const dropped = Object.keys(coordinators).filter((k) => k.startsWith("opencode:"))
  if (dropped.length === 0) return { next: state, dropped: [] }
  const kept: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(coordinators)) if (!dropped.includes(k)) kept[k] = v
  return { next: { ...s, coordinators: kept }, dropped }
}

export interface InvalidateResult {
  /** 这次是否真的动了 qwen 的状态文件 */
  readonly invalidated: boolean
  /** 被摘掉的 coordinator key(便于日志) */
  readonly dropped: readonly string[]
  /** 上一次记录的模型(首次运行为空) */
  readonly previousModel: string
}

/**
 * **每次起网关都作废** coordinator session。
 *
 * 一开始只在"换模型"时作废,2026-08-21 真机证明不够:coordinator 从 17:51 一路复用到 22:45,
 * 历史里堆了十几次"自己动手干"的样例 —— 对 LLM 这是强 few-shot 信号,**压过了我们新加的路由引导**。
 * 表现就是像样的调研任务(全球机器人公司、美国机器人公司)全留在 coordinator 里,不开独立 session。
 *
 * 为什么可以放心地作废:
 *   · coordinator 是**路由器**,不是工作现场 —— 真正的上下文在第三层 project session 里;
 *   · "继续之前那个" 靠 `sessions_list` / `session_send` **查**出来,不靠它自己的记忆
 *     (这本来就是 qwen 的设计意图);
 *   · 沟通记录由我们自己的 journal 维护(voice-journal.ts),**不受 coordinator 生死影响**;
 *   · 顺带省钱:114 个 part 的历史每轮都要重发。
 *
 * 丢的只有"跨网关重启的紧邻指代"(重开语音后说「刚才那个」)。重开语音时本来也不该指望它记得。
 *
 * ⚠️ 只在**起网关那一刻**有效:qwen 的 `ensureCoordinatorSession` 内存 Map 优先于这个文件
 * (`acp-backend-adapter.mjs:346`),网关跑起来之后再删文件是没用的。
 *
 * IO 全部可注入,方便单测;任何一步失败都**只是不作废**(退回原来的行为),
 * 绝不因为读写状态文件出错就让语音起不来。
 */
export function invalidateCoordinatorOnStart(input: {
  readonly backendModel: string
  readonly env?: NodeJS.ProcessEnv
  readonly home?: string
  readonly readFile?: (p: string) => string | null
  readonly writeFile?: (p: string, content: string) => void
}): InvalidateResult {
  const env = input.env ?? process.env
  const home = input.home ?? homedir()
  const read =
    input.readFile ??
    ((p: string) => {
      try {
        return existsSync(p) ? readFileSync(p, "utf8") : null
      } catch {
        return null
      }
    })
  const write =
    input.writeFile ??
    ((p: string, content: string) => {
      try {
        mkdirSync(path.dirname(p), { recursive: true })
        writeFileSync(p, content)
      } catch {}
    })

  // 模型只用来写日志(「从 X 换成了 Y」),不再作为作废的**条件** —— 现在是每次都作废
  const stampPath = voiceModelStampPath(env, home)
  const previousModel = (read(stampPath) ?? "").trim()
  write(stampPath, input.backendModel)

  const statePath = acpSessionStatePath(env, home)
  const raw = read(statePath)
  if (!raw) return { invalidated: false, dropped: [], previousModel }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { invalidated: false, dropped: [], previousModel }
  }
  const { next, dropped } = dropOpencodeCoordinators(parsed)
  if (dropped.length === 0) return { invalidated: false, dropped: [], previousModel }
  write(statePath, JSON.stringify(next, null, 1))
  return { invalidated: true, dropped, previousModel }
}
