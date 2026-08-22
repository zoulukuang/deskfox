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
 * 把 tasks 和 timeline 按 taskId 配对成"轮次"。**运行中的也收。**
 *
 * 2026-08-21 user:「只要发起了,就应该出现在列表里,哪怕是正在运行中的 —— 飞书沟通发起的
 * 都是立刻出现的」。原来只收 completed/failed(等结论一次成型),代价就是刚说完话时
 * 列表里什么都不多,看着像没生效。
 *
 * 改法不是"先写半截再更新"—— `noReply` 只能追加、改不了已写的消息。而是**拆成两条**:
 * 请求一条、结果一条(见 `journalPhase`)。交替下来反而更像对话,还顺带解决了可见性。
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
    // 取消掉的不记 —— 用户自己撤回的动作,留在记录里只会碍眼
    if (state === "cancelled" || state === "cancelling") continue
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
 * 一轮拆成两条消息:**请求**(一发起就写)和**结果**(跑完再写)。
 *
 * 为什么不合成一条:`noReply` 只能追加、改不了已写的消息。要做到"发起就可见",
 * 就只能先把请求写下去,结果作为下一条追加。交替读下来是
 * 「🎙️ 请求 → 回答 → 🎙️ 请求 → 回答」,反而更像对话。
 */
export type JournalPhase = "request" | "answer"

/** 一条待写消息的身份 —— 去重按 `taskId + phase`,请求和结果各写一次 */
export function journalKey(taskId: string, phase: JournalPhase): string {
  return `${taskId}:${phase}`
}

/**
 * 渲染其中一条。
 *
 * 刻意不塞元数据:这条 session 是给人**读**的,taskId / 耗时那些排查信息
 * 在 `voice-gateway.log` 和 `/api/tasks` 里都有,不该占版面。
 */
export function renderTurn(turn: JournalTurn, phase: JournalPhase): string {
  if (phase === "request") return `🎙️ **${turn.objective}**`
  if (turn.state === "failed") return `⚠️ 这一轮没能完成${turn.answer ? `:${turn.answer}` : ""}`
  return turn.answer || "_(这一轮没有留下文字结果)_"
}

export interface PendingWrite {
  readonly turn: JournalTurn
  readonly phase: JournalPhase
}

/**
 * 挑出还没写过的消息。`written` 由调用方跨轮持有 —— 轮询会反复看到同一批任务。
 *
 * 请求**只要任务存在就该写**(包括 running);结果等有结论了才写。
 * 顺序上请求永远排在自己的结果前面,不会出现"先看到答案再看到问题"。
 */
export function pendingWrites(turns: readonly JournalTurn[], written: ReadonlySet<string>): PendingWrite[] {
  const out: PendingWrite[] = []
  for (const turn of turns) {
    if (!written.has(journalKey(turn.taskId, "request"))) out.push({ turn, phase: "request" })
    const settled = turn.state === "completed" || turn.state === "failed"
    if (settled && !written.has(journalKey(turn.taskId, "answer"))) out.push({ turn, phase: "answer" })
  }
  return out
}

/**
 * 这条 session 是不是"中转站"—— 只把活往下派了一层,自己没留下任何给人看的东西。
 *
 * 2026-08-22 真机:同一件事出现 2~3 条 session,其中 9 part 那条的输入是纯任务目标、
 * 工具只有一个 `qwen_audio_agent_*_session_start`;0 part 那条更干脆,什么都没有。
 * 用户看到的就是"同一件事重复了好几遍"。
 *
 * 为什么不在源头拦:
 *   · MCP 是**按 directory 注册**的(`sdk.mcp.add({directory,…})`),同目录所有 session
 *     都能看到那套 session 工具 —— 没法只给协调者;
 *   · 想用 agent 级 permission 禁掉执行者的 session 工具也不行 —— qwen 的 `applyPermissionMode`
 *     会把相关 agent 的 permission **强制覆盖成 `allow`**,我们写的 deny 会被冲掉;
 *   · 只剩 prompt 约束,而 prompt 是软的(引导已把 3 层压到 2 层,但压不到 0)。
 * 所以改在结果侧治理:这种 session 没有任何阅读价值,归档掉即可,不删除(排查时还翻得到)。
 *
 * 判据刻意保守 —— **宁可漏归档,也不能把真干活的藏起来**:
 *   · 一条实质文本都没有(纯中转 / 空壳);
 *   · 且调用过的工具要么没有,要么只有 session 系列。
 */
export function isTransitSession(input: {
  readonly toolNames: readonly string[]
  readonly hasSubstantiveText: boolean
}): boolean {
  if (input.hasSubstantiveText) return false
  return input.toolNames.every((name) => /qwen_audio_agent.*_session/i.test(name))
}

/** 这条 journal session 的标题。带日期,便于一天多次开语音时区分。 */
export function journalTitle(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `语音沟通 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
