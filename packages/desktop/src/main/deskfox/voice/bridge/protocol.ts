// [fork-only] voice-acp-bridge — ACP over stdio 的 JSON-RPC 层 [feat: voice-acp-bridge] 2026-08-24
//
// 传输是 NDJSON:一行一条 JSON-RPC 2.0 消息,stdin 进 / stdout 出
// (qwen 侧 `acp-process-client.mjs:169-172` 的 `acp.ndJsonStream`)。
//
// 三条硬约束,违反任何一条都会让语音链路以难查的方式坏掉:
//
//   ① **stdout 只许写协议帧。** 任何 `console.log` / 库的日志都会混进字节流。qwen 的解析器
//      对非 JSON 行是"跳过 + 自己 stderr 打一条",不会断连 —— 也就是说污染**不会立刻报错**,
//      而是等到某条真帧被截断时才炸,现场早没了。所以本模块只暴露 `send`,日志一律走 stderr。
//      (这也是 voice-dispatch-minimal 时代要写 `deskfox-acp-wrap.mjs` 净化管道的原因;
//       桥是我们自己的进程,从源头不污染就不需要那层 wrapper 了。)
//
//   ② **每个 request 都必须最终有响应。** qwen 侧所有超时都是空转的:它传给 SDK 的是 `signal`,
//      而 SDK 只认 `cancellationSignal`(`jsonrpc.d.ts:84-92`),于是**客户端从不发 `$/cancel_request`、
//      也没有任何硬超时**。请求 Promise 只在"我们回响应"或"进程死了"时 settle。
//      悬而不答 = 那条 session 永久锁死(它对同一 sessionId 只允许一个在途 prompt)。
//
//   ③ **不发 batch**(客户端以 `allowBatches:false` 连接)。
//
// 纯逻辑与 IO 分离:本模块只做编解码与分发,读写由调用方注入,单测不碰真 stdio。

import { createLineSplitter } from "../acp-frame"

export type JsonRpcId = string | number

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0"
  readonly id?: JsonRpcId
  readonly method: string
  readonly params?: unknown
}

export interface JsonRpcError {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

/** JSON-RPC 标准错误码,取我们真会用到的三个。 */
export const RPC_METHOD_NOT_FOUND = -32601
export const RPC_INVALID_PARAMS = -32602
export const RPC_INTERNAL_ERROR = -32603

/**
 * 方法处理器。返回值即 result;抛错会被转成 JSON-RPC error 响应。
 * 通知(无 id)的返回值被丢弃。
 */
export type MethodHandler = (params: unknown, ctx: { readonly id?: JsonRpcId }) => unknown | Promise<unknown>

export interface PeerOptions {
  /** 往 stdout 写一整行(不含换行符,由本模块补) */
  readonly write: (line: string) => void
  /** 诊断日志;一律走 stderr,绝不能写 stdout(见文件头①) */
  readonly log: (message: string) => void
}

export interface Peer {
  /** 喂一段 stdin 数据,内部按行切分并分发 */
  handleChunk(chunk: string): void
  /** 流结束时把残留的半行处理掉 */
  finish(): void
  /** 注册方法处理器 */
  on(method: string, handler: MethodHandler): void
  /** 主动发通知(如 `session/update`) */
  notify(method: string, params: unknown): void
  /** 主动发请求(如 `session/request_permission`),返回对端的 result */
  request(method: string, params: unknown): Promise<unknown>
  /**
   * 迟发响应。handler 返回 `undefined` 表示「我稍后自己回」,长任务走这条 ——
   * 第三层 prompt 可能挂几分钟(qwen 对它设 `timeoutMs: 0`),期间要能继续发 `session/update`。
   */
  respond(id: JsonRpcId | undefined, result: unknown): void
  respondError(id: JsonRpcId | undefined, message: string): void
}

export function createPeer(options: PeerOptions): Peer {
  const handlers = new Map<string, MethodHandler>()
  const pending = new Map<JsonRpcId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const splitter = createLineSplitter()
  let nextId = 1

  const send = (message: unknown): void => {
    options.write(JSON.stringify(message))
  }

  const reply = (id: JsonRpcId, result: unknown): void => {
    // result 必须是对象:SDK 那边多处 `response ?? {}` 兜底,但 null 会让部分 zod 分支炸
    send({ jsonrpc: "2.0", id, result: result === undefined || result === null ? {} : result })
  }

  const replyError = (id: JsonRpcId, error: JsonRpcError): void => {
    send({ jsonrpc: "2.0", id, error })
  }

  const dispatch = (msg: JsonRpcRequest & { result?: unknown; error?: JsonRpcError }): void => {
    // ── 对端对我们请求的回应
    if (msg.method === undefined && msg.id !== undefined) {
      const waiter = pending.get(msg.id)
      if (!waiter) return
      pending.delete(msg.id)
      if (msg.error) waiter.reject(new Error(`${msg.error.message}(code=${msg.error.code})`))
      else waiter.resolve(msg.result)
      return
    }

    const handler = handlers.get(msg.method)
    const id = msg.id

    if (!handler) {
      // 通知没人接就静默忽略(qwen 会发我们没实现的通知是正常的);请求必须回 -32601,
      // 否则按文件头②那条,对端会永远等下去
      if (id !== undefined) replyError(id, { code: RPC_METHOD_NOT_FOUND, message: `未实现的方法:${msg.method}` })
      else options.log(`忽略未处理的通知:${msg.method}`)
      return
    }

    let outcome: unknown
    try {
      outcome = handler(msg.params, { id })
    } catch (e) {
      const message = String((e as { message?: string })?.message ?? e)
      options.log(`处理 ${msg.method} 抛错:${message}`)
      if (id !== undefined) replyError(id, { code: RPC_INTERNAL_ERROR, message, data: { details: message } })
      return
    }

    if (!(outcome instanceof Promise)) {
      // 同步 handler:返回 undefined 表示「响应我自己稍后发」(长任务走这条,见 bridge.ts)
      if (id !== undefined && outcome !== undefined) reply(id, outcome)
      return
    }

    void outcome.then(
      (value) => {
        if (id !== undefined && value !== undefined) reply(id, value)
      },
      (e: unknown) => {
        const message = String((e as { message?: string })?.message ?? e)
        options.log(`处理 ${msg.method} 失败:${message}`)
        // 人话放 data.details:qwen 把它直接拼进用户可见的报错(`acp-process-client.mjs:29-36`)
        if (id !== undefined) replyError(id, { code: RPC_INTERNAL_ERROR, message, data: { details: message } })
      },
    )
  }

  const consume = (lines: readonly string[]): void => {
    for (const line of lines) {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        // 容错而不是崩:上游偶尔混进非协议行不该让语音整个停摆
        options.log(`跳过非 JSON 行:${line.slice(0, 200)}`)
        continue
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        options.log(`跳过非对象消息:${line.slice(0, 200)}`)
        continue
      }
      try {
        dispatch(parsed as JsonRpcRequest)
      } catch (e) {
        options.log(`分发失败:${String((e as { message?: string })?.message ?? e)}`)
      }
    }
  }

  return {
    handleChunk(chunk: string): void {
      consume(splitter.push(chunk))
    },
    finish(): void {
      consume(splitter.flush())
      for (const [, waiter] of pending) waiter.reject(new Error("连接已关闭"))
      pending.clear()
    },
    on(method: string, handler: MethodHandler): void {
      handlers.set(method, handler)
    },
    notify(method: string, params: unknown): void {
      send({ jsonrpc: "2.0", method, params })
    },
    request(method: string, params: unknown): Promise<unknown> {
      const id = nextId++
      return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        send({ jsonrpc: "2.0", id, method, params })
      })
    },
    respond(id: JsonRpcId | undefined, result: unknown): void {
      if (id !== undefined) reply(id, result)
    },
    respondError(id: JsonRpcId | undefined, message: string): void {
      // 人话放 data.details:qwen 把它直接拼进用户可见的报错(`acp-process-client.mjs:29-36`)
      if (id !== undefined) replyError(id, { code: RPC_INTERNAL_ERROR, message, data: { details: message } })
    },
  }
}
