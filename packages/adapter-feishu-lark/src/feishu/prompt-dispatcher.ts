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
}

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
  register(sessionID: string, timeoutMs: number): Promise<DispatchResult> {
    return new Promise<DispatchResult>((resolve, reject) => {
      const existing = this.waiters.get(sessionID)
      if (existing) {
        // [bug-fix: feishu-llm-timeout-surface 2026-06-01]
        // 之前先 delete 再 reject — reject 走 finalize 闭包,finalize 再 get()
        // 拿不到 waiter 早 return,旧 promise 永不 reject(内存泄漏 + 调用方 hang)。
        // 改:不主动 delete,让 existing.reject 内部的 finalize 自然完成 delete + reject。
        clearTimeout(existing.timeoutHandle)
        existing.reject(new Error("superseded by new prompt on same session"))
      }

      const buffer = new Map<string, string>()
      const partOrder: string[] = []

      const finalize = (kind: "resolve" | "reject", value: DispatchResult | Error) => {
        const w = this.waiters.get(sessionID)
        if (!w) return
        clearTimeout(w.timeoutHandle)
        this.waiters.delete(sessionID)
        if (kind === "resolve") resolve(value as DispatchResult)
        else reject(value as Error)
      }

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
