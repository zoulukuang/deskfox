// [fork-only] REQ-102 语音派活 — journal 的 IO 侧 [feat: voice-dispatch-minimal] 2026-08-21
//
// 纯逻辑(配对 / 渲染 / 增量)在 voice-journal.ts,这里只管跟两个 HTTP 打交道:
//   · gateway(3101):读 /api/tasks 与 /api/timeline
//   · 语音宿主的 opencode server(4396):建 session、写消息、归档 coordinator
//
// 全部走 REST,不直接写库 —— 写库能做出更漂亮的"对话气泡",但要自己维护 session/message/part
// 三张表的结构,上游一改 schema 就静默写坏。宁可样式朴素一点。

import log from "electron-log/main.js"
import { GATEWAY_PORT, VOICE_OPENCODE_PORT } from "./launch-config"
import {
  journalKey,
  journalTitle,
  pairTurns,
  pendingWrites,
  renderTurn,
  type VoiceTask,
  type VoiceTimelineItem,
} from "./voice-journal"

const gateway = (path: string) => `http://127.0.0.1:${GATEWAY_PORT}${path}`
const host = (path: string) => `http://127.0.0.1:${VOICE_OPENCODE_PORT}${path}`

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return await res.json()
}

export interface JournalState {
  /** journal session 的 id;第一条要写的时候才建,避免开了语音却没说话也留一条空会话 */
  sessionId: string | null
  /** 已经写进 journal 的 taskId —— 轮询会反复看到同一批已完成任务 */
  readonly written: Set<string>
  /** 已经归档过的 coordinator sessionId,别每轮都发一次归档请求 */
  readonly archived: Set<string>
}

export function createJournalState(): JournalState {
  return { sessionId: null, written: new Set(), archived: new Set() }
}

/**
 * 把 coordinator session 归档,让它从项目列表消失。
 *
 * 它是路由器的内部账本(每轮一段英文协议 XML + JSON 回复),不是给人读的;
 * 真正的沟通在 journal、真正的工作在第三层 session。用**归档**而不是删除 ——
 * 排查时还翻得到,只是不占列表。
 */
export async function archiveCoordinator(input: {
  readonly directory: string
  readonly sessionId: string
  readonly state: JournalState
}): Promise<boolean> {
  if (!input.sessionId || input.state.archived.has(input.sessionId)) return false
  try {
    const url = host(`/session/${input.sessionId}?directory=${encodeURIComponent(input.directory)}`)
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ time: { archived: Date.now() } }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(String(res.status))
    input.state.archived.add(input.sessionId)
    log.info(`[voice] 已归档 coordinator session ${input.sessionId}(它是协议流水,不进项目列表)`)
    return true
  } catch (e) {
    // 归档失败只是列表里多一条不好看的会话,不值得打断任何事
    log.warn(`[voice] 归档 coordinator 失败:${String(e)}`)
    return false
  }
}

/** 建 journal session(懒建:第一条要写时才建) */
async function ensureJournalSession(directory: string, state: JournalState, now: Date): Promise<string | null> {
  if (state.sessionId) return state.sessionId
  try {
    const res = await fetch(host(`/session?directory=${encodeURIComponent(directory)}`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: journalTitle(now) }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(String(res.status))
    const info = (await res.json()) as { id?: string }
    state.sessionId = String(info?.id ?? "") || null
    return state.sessionId
  } catch (e) {
    log.warn(`[voice] 建语音沟通 session 失败:${String(e)}`)
    return null
  }
}

/**
 * 拉一次 gateway,把新完成的轮次追加进 journal。
 *
 * `noReply: true` 是关键 —— 只落库不触发模型(实测 246ms 返回、不烧额度)。
 * 任何一步失败都只记日志:journal 是**旁路记录**,它挂了不该影响语音本身。
 */
export async function syncJournal(input: {
  readonly directory: string
  readonly state: JournalState
  readonly now?: Date
  /**
   * 首轮只建基线,不写入。
   *
   * `/api/tasks` 返回的是**跨会话累积**的任务 —— 刚起网关那一下就能看到上次语音留下的一堆
   * completed。不做这一步的话,新建的「语音沟通」session 开头会凭空多出几轮别人的对话。
   */
  readonly seedOnly?: boolean
}): Promise<number> {
  let tasks: readonly VoiceTask[] = []
  let timeline: readonly VoiceTimelineItem[] = []
  try {
    const [t, l] = await Promise.all([getJson(gateway("/api/tasks")), getJson(gateway("/api/timeline"))])
    tasks = ((t as { tasks?: VoiceTask[] })?.tasks ?? []) as VoiceTask[]
    timeline = ((l as { items?: VoiceTimelineItem[] })?.items ?? []) as VoiceTimelineItem[]
  } catch {
    return 0 // 网关正在起/停,下一轮再说
  }

  const turns = pairTurns(tasks, timeline)
  if (input.seedOnly) {
    // 历史任务的请求和结果都算写过 —— 它们属于上一次语音会话
    for (const turn of turns) {
      input.state.written.add(journalKey(turn.taskId, "request"))
      input.state.written.add(journalKey(turn.taskId, "answer"))
    }
    log.info(`[voice] 语音沟通记录建立基线:忽略 ${turns.length} 条历史任务`)
    return 0
  }

  const fresh = pendingWrites(turns, input.state.written)
  if (fresh.length === 0) return 0

  const sessionId = await ensureJournalSession(input.directory, input.state, input.now ?? new Date())
  if (!sessionId) return 0

  let written = 0
  for (const { turn, phase } of fresh) {
    try {
      const res = await fetch(
        host(`/session/${sessionId}/message?directory=${encodeURIComponent(input.directory)}`),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ noReply: true, parts: [{ type: "text", text: renderTurn(turn, phase) }] }),
          signal: AbortSignal.timeout(10_000),
        },
      )
      if (!res.ok) throw new Error(String(res.status))
      input.state.written.add(journalKey(turn.taskId, phase))
      written++
    } catch (e) {
      // 这一条没写成就别记进 written,下一轮还会重试
      log.warn(`[voice] 写语音沟通记录失败 task=${turn.taskId} phase=${phase}: ${String(e)}`)
    }
  }
  if (written > 0) log.info(`[voice] 语音沟通 session 追加 ${written} 条`)
  return written
}
