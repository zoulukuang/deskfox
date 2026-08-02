// [fork-only] PromptDispatcher — opencode plugin event hook ↔ pipeline waiter 桥梁
// [feat: feishu-bridge] 2026-05-08
//
// plugin 注册 `event` hook 后,所有 opencode events 都通过 hook 推过来。
// 每个进行中的 prompt 注册一个 waiter,dispatcher 按 sessionID 路由 events
// 到对应 waiter,累积 message.part.delta(text)token,session.idle 时 resolve。
//
// !! 已知 bug(2026-05-09 待修)— 此累积也包括 user message 自己 prompt 的 text part,
// 导致 reply echo user 自己的输入。修复需要按 message role 区分,留 followup commit。
// 短期:接受 echo,以确保 user 至少能看到 reply(总比 empty reply 好)。
//
// 2026-06-01 [feat: feishu-llm-timeout-surface]
// register 返回值从 Promise<string> 升级为 Promise<DispatchResult>,timeout 时
// partial.trim() 为空一律 reject(原 if (partial) 条件依赖 truthiness,collectText
// 返非空白字符串过滤已生效,但显式 trim 后空 → reject,语义更直白)。runOpencode
// 据 source 字段决定是否走 session.messages 兜底拉 final 还是直接用 partial。

interface Waiter {
  buffer: Map<string, string> // partID → cumulative text
  partOrder: string[]
  resolve: (result: DispatchResult) => void
  reject: (err: Error) => void
  timeoutHandle: ReturnType<typeof setTimeout>
  /**
   * [fix: feishu-llm-stall-fastfail 2026-06-07]
   * "首字节活动"快速失败定时器 — provider 卡在可重试错误(如 getbot 503)时**不发任何 part、
   * 也不报 session.error**,原本只能干等到 timeoutMs(默认 30min),期间同 chat 串行队列被堵死。
   * 此定时器在首个活动(任意 message.part)到达时清除;若在 firstActivity 窗口内毫无活动 →
   * 判定 provider 无响应,提前 reject 释放队列。收到首活动后即清除,不误伤正常长任务。
   */
  firstActivityHandle: ReturnType<typeof setTimeout> | undefined
  // [feat: feishu-retry-feedback] REQ-093 2026-08-02 —— retry 事件支撑
  /** 本 turn 已收到的核心自动重试次数(session.status type=retry 计数)*/
  retryCount: number
  /** retry 事件回调(pipeline 层做节流播报)*/
  onRetry?: (info: RetryNotice) => void
  /** fastfail 窗口毫秒数 + 触发闭包 —— retry 事件视为 activity 重置窗口用(施工注意⑤)*/
  faMs: number
  fireFastfail: () => void
}

/** [feat: feishu-retry-feedback] REQ-093 — retry 事件透传给 pipeline 的最小信息 */
export interface RetryNotice {
  attempt: number
  message?: string
  /** 核心给的下次重试时间戳(ms,可能缺省)*/
  next?: number
}

/** [feat: feishu-retry-feedback] fastfail 错误文案锚点 — runOpencode 据此判定走 session.abort */
export const FASTFAIL_ERROR_MARKER = "首字节超时"

/** 默认"首字节活动"超时(ms)— provider 完全无输出多久判定卡死。
 *  [fix: feishu-review-followup 2026-06-07] 120s → 240s:留足推理模型(如 deepseek-r1)
 *  长思考+非增量流式场景的首字节余量,降低误杀正常慢响应;仍比 30min 硬超时快 7.5×。 */
export const DEFAULT_FIRST_ACTIVITY_TIMEOUT_MS = 240_000

/** opencode plugin event 形状(对齐 Bus event payload)*/
export interface OpencodeEventLike {
  type: string
  properties?: Record<string, unknown>
}

/**
 * dispatcher 把 session.idle / timeout-有partial 两种"成功"路径
 * 用 source 字段区分,让上层 runOpencode 能针对性处理(timeout-partial
 * 时 partial 可能不完整,session.messages 拉一次 final 更准)。
 *
 * 其余三类"失败"路径 — timeout-无partial / session.error / abortAll / superseded —
 * 全部走 reject,上层 catch 后走 friendlyErrorReply 给 user surface。
 */
export interface DispatchResult {
  reply: string
  source: "session.idle" | "timeout-partial"
}

export class PromptDispatcher {
  private readonly waiters = new Map<string, Waiter>()

  /**
   * 注册一个 sessionID 的 prompt waiter。
   *
   * @returns Promise<DispatchResult> — session.idle 时 resolve(reply + source);
   *          session.error / abortAll / superseded / timeout 且无 partial 时 reject。
   */
  register(
    sessionID: string,
    timeoutMs: number,
    firstActivityTimeoutMs: number = DEFAULT_FIRST_ACTIVITY_TIMEOUT_MS,
    // [feat: feishu-retry-feedback] REQ-093 — 核心自动重试事件回调(节流在 pipeline 层)
    onRetry?: (info: RetryNotice) => void,
  ): Promise<DispatchResult> {
    return new Promise<DispatchResult>((resolve, reject) => {
      const existing = this.waiters.get(sessionID)
      if (existing) {
        // [bug-fix: feishu-llm-timeout-surface 2026-06-01]
        // 之前先 delete 再 reject — reject 走 finalize 闭包,finalize 再 get()
        // 拿不到 waiter 早 return,旧 promise 永不 reject(内存泄漏 + 调用方 hang)。
        // 改:不主动 delete,让 existing.reject 内部的 finalize 自然完成 delete + reject。
        clearTimeout(existing.timeoutHandle)
        if (existing.firstActivityHandle) clearTimeout(existing.firstActivityHandle)
        existing.reject(new Error("superseded by new prompt on same session"))
      }

      const buffer = new Map<string, string>()
      const partOrder: string[] = []

      const finalize = (kind: "resolve" | "reject", value: DispatchResult | Error) => {
        const w = this.waiters.get(sessionID)
        if (!w) return
        clearTimeout(w.timeoutHandle)
        if (w.firstActivityHandle) clearTimeout(w.firstActivityHandle)
        this.waiters.delete(sessionID)
        if (kind === "resolve") resolve(value as DispatchResult)
        else reject(value as Error)
      }

      // [fix: feishu-llm-stall-fastfail 2026-06-07]
      // 首字节活动快速失败:firstActivity 窗口内毫无 part → provider 卡死,提前 reject 释放队列。
      // 上限不超过 timeoutMs(测试传小 timeout 时不被 firstActivity 反超)。message 含"超时"+
      // "无任何输出"→ 命中 friendlyErrorReply 的 timeout pattern,飞书侧给"模型繁忙/换 model"提示。
      const faMs = Math.min(firstActivityTimeoutMs, timeoutMs)
      // [feat: feishu-retry-feedback] REQ-093 — 触发闭包抽名:retry 事件重置窗口时要重装同一逻辑;
      // 有过重试时文案拼「已自动重试 N 次」(命中 friendlyErrorReply 重试终态 pattern,
      // 并作为 FASTFAIL_ERROR_MARKER 锚点让 runOpencode 走 session.abort 防僵尸)
      const fireFastfail = () => {
        const w = this.waiters.get(sessionID)
        if (!w) return
        const retried =
          w.retryCount > 0 ? `(provider 繁忙,已自动重试 ${w.retryCount} 次仍无输出)` : `(provider 可能繁忙/无响应,如 503 重试)`
        finalize(
          "reject",
          new Error(`opencode prompt ${FASTFAIL_ERROR_MARKER} (${faMs}ms) — LLM 无任何输出${retried}`),
        )
      }
      const firstActivityHandle = setTimeout(fireFastfail, faMs)

      const timeoutHandle = setTimeout(() => {
        const w = this.waiters.get(sessionID)
        if (!w) return
        const partial = collectText(w)
        if (partial.trim()) {
          console.warn(`[dispatcher] timeout for ${sessionID},返 partial`)
          finalize("resolve", { reply: partial, source: "timeout-partial" })
        } else {
          // [bug-fix: feishu-llm-timeout-surface 2026-06-01]
          // 之前依赖 truthiness,但极端 case(provider hang 不发任何 part 或
          // 只发 0-长度 part)partial = "" 时若不 trim,if (partial) 已是 false
          // 进 reject,行为正确。但 trim 加在这里语义更稳:任何 whitespace-only
          // partial 也一律 reject(否则上层 session.messages 兜底还是会拉空)。
          finalize(
            "reject",
            new Error(
              `opencode prompt timeout (${timeoutMs}ms) — LLM 在超时窗口内无任何输出`,
            ),
          )
        }
      }, timeoutMs)

      this.waiters.set(sessionID, {
        buffer,
        partOrder,
        resolve: (result) => finalize("resolve", result),
        reject: (err) => finalize("reject", err),
        timeoutHandle,
        firstActivityHandle,
        // [feat: feishu-retry-feedback] REQ-093
        retryCount: 0,
        onRetry,
        faMs,
        fireFastfail,
      })
    })
  }

  dispatch(event: OpencodeEventLike): void {
    if (event.type === "message.part.updated") {
      const p = event.properties as
        | {
            part?: { id?: string; sessionID?: string; type?: string; text?: string }
            delta?: string
          }
        | undefined
      const part = p?.part
      const sid = part?.sessionID
      if (!sid) return
      const w = this.waiters.get(sid)
      if (!w) return
      // [fix: feishu-llm-stall-fastfail 2026-06-07]
      // 任意 part(text / tool / 其它)到达 = provider 已开始响应 → 清首字节快速失败定时器。
      // 放在 text-type 过滤之前:工具调用先于 text part 时也算"有活动",不误杀。
      if (w.firstActivityHandle) {
        clearTimeout(w.firstActivityHandle)
        w.firstActivityHandle = undefined
      }
      if (part.type !== "text") return
      const partID = part.id
      if (!partID) return
      // v1 message.part.updated 的 part.text 是 cumulative(覆盖)
      if (typeof part.text === "string") {
        if (!w.buffer.has(partID)) {
          w.partOrder.push(partID)
        }
        w.buffer.set(partID, part.text)
      } else if (typeof p?.delta === "string") {
        if (!w.buffer.has(partID)) {
          w.buffer.set(partID, "")
          w.partOrder.push(partID)
        }
        w.buffer.set(partID, (w.buffer.get(partID) ?? "") + p.delta)
      }
      return
    }

    const props = event.properties as { sessionID?: string } | undefined
    const sessionID = props?.sessionID
    if (!sessionID) return
    const w = this.waiters.get(sessionID)
    if (!w) return

    // [feat: feishu-retry-feedback] REQ-093 — 核心自动重试事件:
    // ① 计数 + 回调(pipeline 层节流播报「正在重试第 N 次」);
    // ② retry 视为 activity 重置 fastfail 窗口(施工注意⑤:核心退避带 rate-limit header
    //    时可 >240s,不重置会出现「刚播报重试中就被 fastfail 硬杀」的矛盾;重置后语义 =
    //    距上次 activity/retry 事件超窗才判死)。真实 part 已到过(handle 已清)则不重装,
    //    不影响长任务 30min 硬超时语义。
    if (event.type === "session.status") {
      const p = event.properties as
        | { sessionID?: string; status?: { type?: string; attempt?: number; message?: string; next?: number } }
        | undefined
      const status = p?.status
      if (!status || status.type !== "retry") return
      w.retryCount += 1
      if (w.firstActivityHandle) {
        clearTimeout(w.firstActivityHandle)
        w.firstActivityHandle = setTimeout(w.fireFastfail, w.faMs)
      }
      try {
        w.onRetry?.({ attempt: status.attempt ?? w.retryCount, message: status.message, next: status.next })
      } catch (err) {
        console.warn(`[dispatcher] onRetry callback error for ${sessionID}:`, err)
      }
      return
    }

    if (event.type === "session.idle") {
      w.resolve({ reply: collectText(w), source: "session.idle" })
      return
    }
    if (event.type === "session.error") {
      const p = event.properties as { error?: { message?: string } }
      w.reject(new Error(p.error?.message ?? "opencode session error"))
      return
    }
  }

  get pending(): number {
    return this.waiters.size
  }

  abortAll(): void {
    for (const [, w] of this.waiters) {
      clearTimeout(w.timeoutHandle)
      if (w.firstActivityHandle) clearTimeout(w.firstActivityHandle)
      w.reject(new Error("dispatcher aborted"))
    }
    this.waiters.clear()
  }
}

function collectText(w: Waiter): string {
  return w.partOrder
    .map((id) => w.buffer.get(id) ?? "")
    .filter((t) => t.length > 0)
    .join("\n")
    .trim()
}
