// [fork-only] REQ-102 语音派活 — 任务落库后通知界面刷新会话列表 [feat: voice-dispatch-minimal] 2026-08-21
//
// 起因(2026-08-21 user 真机):语音派完活,DeskFox 的会话列表里**看不到新会话** ——
// 但会话其实已经写进库了(`分析今日A股市场盘面` 17:51 就在)。
//
// 根因不是 bug 而是架构:语音的 ACP 宿主是**另一个 opencode 进程**,和 DeskFox 主实例
// 共享同一个 SQLite,但**各有各的 event bus**。主实例没收到任何 `session.updated`,
// 自然不会去重拉列表。跨进程共享 db 而不共享事件,这个缺口只能我们自己补。
//
// 补法:轮询 gateway 的 `/api/tasks`,任务集合一变就通知 renderer 去 invalidate 会话查询。
// 为什么是轮询而不是接 gateway 的 WS:realtime 那条连接是有状态的(voice_client 会参与
// 输入仲裁 / 播放回执),挂一个纯观察者进去可能干扰真实语音客户端;
// `/api/tasks` 是无副作用的只读 HTTP,几秒一次的本地请求代价可以忽略。

/** 任务集合的指纹 —— 只关心「有哪些任务、各自什么状态」,进度百分比之类的抖动不该触发刷新 */
export function taskSignature(payload: unknown): string {
  if (!payload || typeof payload !== "object") return ""
  const tasks = (payload as { tasks?: unknown }).tasks
  if (!Array.isArray(tasks)) return ""
  return tasks
    .map((t) => {
      const item = (t ?? {}) as { id?: unknown; workId?: unknown; workState?: unknown; status?: unknown }
      return `${String(item.id ?? item.workId ?? "")}:${String(item.workState ?? item.status ?? "")}`
    })
    .filter((s) => s !== ":")
    .sort()
    .join("|")
}

/**
 * 这次变化值不值得刷列表。
 *
 * **首次拿到快照不算变化** —— 刚起网关时把历史任务一次性读进来,那批不是「刚发生的事」,
 * 拿它触发刷新等于每次开语音都无谓抖一下界面。
 */
export function shouldRefresh(previous: string | null, next: string): boolean {
  if (previous === null) return false
  return previous !== next
}

export interface TaskWatchHandle {
  readonly stop: () => void
}

/**
 * 起一个轮询。`fetchTasks` 与 `notify` 都可注入,方便单测跑真实时序而不碰网络。
 * 任何一次抓取失败都**静默跳过**(网关正在起 / 正在停都会失败),不打断轮询也不吵日志。
 */
export function startTaskWatch(input: {
  readonly fetchTasks: () => Promise<unknown>
  readonly notify: () => void
  /**
   * 每次成功抓到数据都调,**首轮也调**(`first=true`)。
   * 与 `notify` 的区别:notify 是"有变化才叫你",onPoll 是"每轮都给你看一眼"。
   * 语音沟通记录要的是后者 —— 它自己按 taskId 去重,但**必须拿到首轮快照**
   * 才能把上一次会话遗留的任务标记成历史、不写进这次的记录。
   */
  readonly onPoll?: (payload: unknown, first: boolean) => void
  readonly intervalMs?: number
  readonly setInterval?: (fn: () => void, ms: number) => unknown
  readonly clearInterval?: (handle: unknown) => void
}): TaskWatchHandle {
  const intervalMs = input.intervalMs ?? 4000
  const setI = input.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms))
  const clearI = input.clearInterval ?? ((h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>))
  let previous: string | null = null
  let stopped = false

  const tick = () => {
    void (async () => {
      if (stopped) return
      let payload: unknown
      try {
        payload = await input.fetchTasks()
      } catch {
        return
      }
      if (stopped) return
      const next = taskSignature(payload)
      input.onPoll?.(payload, previous === null)
      if (shouldRefresh(previous, next)) input.notify()
      previous = next
    })()
  }

  const handle = setI(tick, intervalMs)
  tick() // 立刻抓一次建立基线,免得第一次变化要等满一个周期
  return {
    stop() {
      stopped = true
      clearI(handle)
    },
  }
}
