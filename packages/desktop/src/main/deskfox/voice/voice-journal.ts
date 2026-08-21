// [fork-only] REQ-102 语音派活 — 把语音沟通写成一条可读的 session [feat: voice-dispatch-minimal] 2026-08-21
//
// 起因(2026-08-21 user):「我直接语音沟通的 session 要展示在项目列表里」,而且
// 「这个 session 展示的内容几乎不可看,能不能向手打会话看齐」。
//
// 为什么 coordinator session 不可看 —— 取证统计它的 7 轮对话:
//   · 英文协议 XML 信封(`<qwen_audio_agent_backend_instructions>…`,还是**每轮都发**):7 条
//   · JSON 协议回复(`{"work_id":…,"state":"completed"}`):6 条
//   · 人话:3 条
// 它是**机器对机器的协议流水**,是路由器的工作台,内容本来就不是给人看的。
// 靠"美化渲染"救不回来 —— 那些字节里根本没有可读的对话。
//
// 所以另造一条:数据取自 gateway 的两个只读 HTTP 接口 ——
//   · `/api/tasks`   → `objective`(这一轮你要它做什么,LLM 已消解指代,比 ASR 原话更完整)
//   · `/api/timeline`→ `content`(markdown 格式的回答,和手打会话里的回复同一种东西)
// 按 `taskId` 配对成一轮,渲染成 markdown 写进 session。
//
// 写入走 `POST /session/:id/message` + **`noReply: true`** —— 只落库不触发模型
// (实测 246ms 返回、不烧额度)。opencode 的 REST 没有"灌入 assistant 消息"的能力,
// 所以一轮往返合成**一条** user 消息;UI 上是一个气泡,但 markdown 正常渲染、内容完整。
//
// ⚠️ 闲聊(纯问答、没派活)不产生 task,因此**不会进这条 journal**。这是当前取舍:
// 覆盖所有有实质内容的轮次,代价是漏掉"现在几点了"这类。要补的话得连 WS 收 transcript.final。

/** gateway `/api/tasks` 里我们用得到的字段 */
export interface VoiceTask {
  readonly id?: string
  readonly workId?: string
  readonly objective?: string
  readonly workState?: string
  readonly createdAt?: number
}

/** gateway `/api/timeline` 里我们用得到的字段 */
export interface VoiceTimelineItem {
  readonly taskId?: string
  readonly title?: string
  readonly content?: string
  readonly createdAt?: number
}

export interface JournalTurn {
  readonly taskId: string
  readonly objective: string
  readonly answer: string
  readonly state: string
  readonly createdAt: number
}

/**
 * 把 tasks 和 timeline 按 taskId 配对成"轮次"。
 *
 * 只收**已经有结论**的轮次(completed / failed):还在跑的写进去会是半截,
 * 而且下一轮轮询还会再看到它 —— 那就得处理"更新已写入的消息",而 noReply 只能追加。
 * 等它跑完再写,一次成型。
 */
export function pairTurns(tasks: readonly VoiceTask[], timeline: readonly VoiceTimelineItem[]): JournalTurn[] {
  const answers = new Map<string, VoiceTimelineItem>()
  for (const item of timeline) {
    const key = String(item?.taskId ?? "")
    if (!key) continue
    // 同一个 task 可能有多条 timeline(阶段结果),取最后一条 —— 那是最终交付
    const previous = answers.get(key)
    if (!previous || Number(item.createdAt ?? 0) >= Number(previous.createdAt ?? 0)) answers.set(key, item)
  }

  const out: JournalTurn[] = []
  for (const task of tasks) {
    const id = String(task?.id ?? task?.workId ?? "")
    if (!id) continue
    const state = String(task.workState ?? "")
    if (state !== "completed" && state !== "failed") continue
    const objective = String(task.objective ?? "").trim()
    if (!objective) continue
    out.push({
      taskId: id,
      objective,
      answer: String(answers.get(id)?.content ?? "").trim(),
      state,
      createdAt: Number(task.createdAt ?? 0),
    })
  }
  return out.sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * 一轮对话渲染成一条消息。
 *
 * 刻意做成「请求 + 分隔线 + 回答」而不是塞一堆元数据:这条 session 是给人**读**的,
 * taskId / 耗时那些排查信息在 `voice-gateway.log` 和 `/api/tasks` 里都有,不该占版面。
 */
export function renderTurn(turn: JournalTurn): string {
  const head = `🎙️ **${turn.objective}**`
  if (turn.state === "failed") {
    return [head, "", "---", "", `⚠️ 这一轮没能完成${turn.answer ? `:${turn.answer}` : ""}`].join("\n")
  }
  if (!turn.answer) return [head, "", "---", "", "_(这一轮没有留下文字结果)_"].join("\n")
  return [head, "", "---", "", turn.answer].join("\n")
}

/** 挑出还没写过的轮次。`written` 由调用方跨轮持有 —— 轮询会反复看到同一批已完成任务。 */
export function pendingTurns(turns: readonly JournalTurn[], written: ReadonlySet<string>): JournalTurn[] {
  return turns.filter((t) => !written.has(t.taskId))
}

/** 这条 journal session 的标题。带日期,便于一天多次开语音时区分。 */
export function journalTitle(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `语音沟通 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
