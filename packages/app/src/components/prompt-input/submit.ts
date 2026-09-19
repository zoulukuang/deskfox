import type { FileSelection } from "@/context/file"
import type { Message, Session } from "@opencode-ai/sdk/v2/client"
import { showToast } from "@/utils/toast"
// FORK: REQ-049 [feat: sidecar-oom-brake] 2026-08-02
import { isBackendUnreachableError } from "@/utils/server-errors"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Binary } from "@opencode-ai/core/util/binary"
import { useNavigate, useParams, useSearchParams } from "@solidjs/router"
import { batch, startTransition, type Accessor } from "solid-js"
import { useTabs } from "@/context/tabs"
import { useServerSync, type ServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useLocal, type ModelSelection } from "@/context/local"
import { usePermission } from "@/context/permission"
import { type ContextItem, type ImageAttachmentPart, type Prompt, type usePrompt } from "@/context/prompt"
import { useSDK, type DirectorySDK } from "@/context/sdk"
import { useSync, type DirectorySync } from "@/context/sync"
import { Identifier } from "@/utils/id"
import { Worktree as WorktreeState } from "@/utils/worktree"
import { buildRequestParts } from "./build-request-parts"
import { commentRestorePayload } from "./comment-restore"
import { clearableContextItems } from "./context-gate"
import { setCursorPosition } from "./editor-dom"
import { formatServerError } from "@/utils/server-errors"
import { ScopedKey } from "@/utils/server-scope"
import { createPromptSubmissionState } from "./submission-state"
import { normalizeSessionInfo } from "@/utils/session"
import { Event } from "@opencode-ai/schema/event"
import { blobDataUrl } from "@/utils/draft-store"

type PendingPrompt = {
  abort: AbortController
  cleanup: VoidFunction
}

// FORK-BEGIN: REQ-100 ④ 消息静默蒸发 —— 把"挂住"变成一次真实的失败
// [feat: release-closeout-2026-09] 2026-09-17
//
// 2026-08-18 真机证据链:用户那条带 <chat selection> 的消息在服务端 message 表 / session_input 表 /
// 日志三处皆无,前端却已乐观挂上时间线并置 busy,然后永久停在"思考中"
// (实测 ≥38 分钟、横跨一次后端 respawn 仍未复位)。
//
// 关键发现:回吐路径(撤乐观消息 + 回填输入框 + toast + busy 归 idle)**早就存在**于本文件的
// catch 里 —— 它只是从来没被触发:后端半死时请求既不 resolve 也不 reject(挂住),catch 永远等不到。
// 故本闸只做一件事:给请求加超时并 **abort**,把"挂住"翻译成一次 reject。
//
// 为什么必须 abort 而不是只 Promise.race:只 race 的话请求可能在回吐之后才落地,
// 用户会看到"输入框里一条 + 时间线上又一条",甚至重复发送(spec §7 R3)。
//
// ⚠️ FORK 2026-09-18 发版前 review 补记 —— **abort 只拆客户端这一侧**。
//   promptAsync 是"收下即调度"的异步准入端点:若服务端已经把请求体读完并 durably admit、
//   只是回包卡住,客户端 abort 并不能把它撤回来 —— 那条消息其实在跑,而我们却回吐 + 报"没送达",
//   用户再发一次就是重复的一轮。
//   概率评估:正常 admit 是毫秒级返回,长时间静默**绝大多数**意味着根本没走到 admit,
//   所以这是窄边角而非常态;且两害相权,"消息还在你手里"比"消息凭空消失"轻得多,回吐语义保留。
//   本次处置 = ① 把断言改成不把话说死(toast 从「这条没发出去」改为「可能没发出去」+
//   明确提示"重发前先看一眼对话里是否已经有了")② 把阈值放宽到 2 分钟(见下),**均不改行为**。
//
//   ⚠️ **这类问题靠"猜"是结构性解决不了的** —— 通道不可靠时发送方无法知道对方收到没有,
//   「恰好一次**投递**」可证明做不到;能做到的是「恰好一次**效果**」,手段只有幂等。
//   终极解 = **幂等准入 + 安全重试**:客户端超时后不猜、不回吐,拿**同一个 messageID** 原样重试;
//   服务端见到已准入过的 ID 就返回既有那一轮、不开新的 → 重试成为无害操作,这个 toast 直接不需要存在。
//   前提已具备(已查证):客户端 :166 生成 messageID 并随请求发出,服务端
//   `packages/opencode/src/session/prompt.ts:666` 用 `input.messageID ?? MessageID.ascending()` 采纳它,
//   即**消息身份本来就由客户端掌握**。缺的只是准入处的去重(那条 user 消息行即天然的准入记录)。
//   代价:改动落在上游 prompt.ts 准入路径,需 1 笔 R4 override。已入需求池 REQ-135(P1)。
//
// 阈值:promptAsync 是**异步准入**端点(收下消息即返回,不等模型回答),正常 RTT 毫秒级。
//   2026-09-18 user 拍板从 20s 放宽到 **2 分钟**:20s 太短时误报的是"服务端其实已 admit、
//   只是回包慢"这一类 —— 而误报的代价是用户重发出重复的一轮。两分钟静默几乎只可能是后端真卡死,
//   误报率大幅下降;代价只是真卡死时多等 100 秒,相对"卡 ≥38 分钟且消息凭空消失"的原病症仍是巨大改善。
//   注:这是**压低误报概率**,不是消除 —— 消除要等 REQ-135 的幂等准入。
const PROMPT_DELIVERY_TIMEOUT_MS = 120_000

/** REQ-100 ① 点停止后本地强制置 idle 的兜底窗口(spec 定 3–5s,取中位) */
const STOP_FALLBACK_IDLE_MS = 4_000

/**
 * FORK: 停止兜底定时器的句柄表(按 sessionID)。
 * [bug-repro: 点停止后 2 秒内改好提示词重新发送 → 新消息乐观置 busy → T+4s 旧定时器醒来,
 *  看到 type==="busy" 就置 idle → 新消息真正在跑,UI 却显示空闲、停止按钮消失]
 * 首版只 setTimeout 不存句柄、也不校验"是不是还是被停的那一轮",于是兜底本身变成了
 * 它要消灭的那种幻影状态的镜像。发新消息时必须先撤掉上一轮的兜底。
 * [feat: release-closeout-2026-09] 2026-09-18
 */
const stopFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>()

function cancelStopFallback(sessionID: string) {
  const timer = stopFallbackTimers.get(sessionID)
  if (timer === undefined) return
  clearTimeout(timer)
  stopFallbackTimers.delete(sessionID)
}

/** 消息没送达(超时 abort)—— 区别于后端明确报错,文案与处置都不同 */
export class PromptNotDeliveredError extends Error {
  readonly notDelivered = true
  constructor() {
    super("prompt not delivered: backend did not respond in time")
    this.name = "PromptNotDeliveredError"
  }
}

export function isPromptNotDelivered(error: unknown): error is PromptNotDeliveredError {
  return !!error && typeof error === "object" && (error as { notDelivered?: unknown }).notDelivered === true
}

/**
 * 给「把消息交给后端」的请求套送达超时。
 *
 * 两件事都要做,缺一不可:
 *   · abort:掐断底层请求,保证它不会在回吐之后才落地造成双份
 *   · deadline reject:**不依赖**下游肯听 signal。api 经 lazyApi 代理,调用被包在
 *     `protocol.then(...)` 里 —— 后端不可达时连协议探测都可能挂住,abort 压根传不到 fetch。
 *
 * FORK 2026-09-18:原先只有 prompt 一条路径套了它,`/command` 两处漏掉 ——
 * 后端半死时斜杠命令照样"既不 resolve 也不 reject",REQ-100 ④ 的病在那条路径上原样保留。
 * 抽成 helper 后三处同待遇。
 */
export async function withDeliveryDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = PROMPT_DELIVERY_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let rejectDeadline: ((reason: unknown) => void) | undefined
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject
  })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
    rejectDeadline?.(new PromptNotDeliveredError())
  }, timeoutMs)
  try {
    const running = run(controller.signal)
    // 超时胜出时 running 可能稍后才 reject(abort 的 DOMException),挂 no-op 防未捕获拒绝
    running.catch(() => {})
    return await Promise.race([running, deadline])
  } catch (err) {
    if (timedOut) throw new PromptNotDeliveredError()
    throw err
  } finally {
    clearTimeout(timer)
  }
}
// FORK-END

const pending = new Map<string, PendingPrompt>()

export type FollowupDraft = {
  sessionID: string
  sessionDirectory: string
  prompt: Prompt
  context: (ContextItem & { key: string })[]
  agent: string
  model: { providerID: string; modelID: string }
  variant?: string
}

type FollowupSendInput = {
  api: DirectorySDK["api"]["session"]
  serverSync: ServerSync
  sync: DirectorySync
  draft: FollowupDraft
  messageID?: string
  optimisticBusy?: boolean
  before?: () => Promise<boolean> | boolean
  /** FORK: REQ-100 ④ 送达超时,仅供测试注入;生产走 PROMPT_DELIVERY_TIMEOUT_MS */
  deliveryTimeoutMs?: number
}

const draftText = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

const draftImages = (prompt: Prompt) => prompt.filter((part): part is ImageAttachmentPart => part.type === "image")

export async function sendFollowupDraft(input: FollowupSendInput) {
  // FORK 2026-09-18 第三轮 review:这条路径同样是「新一轮发送」,必须撤掉上一轮「停止」留下的兜底。
  //   [bug-repro: 点停止 → 4s 内队列排干 / 手动重发走到这里 → T+4s 旧定时器醒来把**这条正在跑的新消息**
  //    打成 idle → queueEnabled 转假 → 下一条绕过队列与上一轮并发。]
  //   首版只在 handleSubmit 里撤,followup / 队列这条路径原样保留了缺陷。
  cancelStopFallback(input.draft.sessionID)
  const text = draftText(input.draft.prompt)
  const images = draftImages(input.draft.prompt)
  const setBusy = () => {
    if (!input.optimisticBusy) return
    input.serverSync.session.set("session_status", input.draft.sessionID, { type: "busy" })
  }

  const setIdle = () => {
    if (!input.optimisticBusy) return
    input.serverSync.session.set("session_status", input.draft.sessionID, { type: "idle" })
  }

  const wait = async () => {
    const ok = await input.before?.()
    if (ok === false) return false
    return true
  }

  const [head, ...tail] = text.split(" ")
  const cmd = head?.startsWith("/") ? head.slice(1) : undefined
  if (cmd && input.sync.data.command.find((item) => item.name === cmd)) {
    setBusy()
    try {
      if (!(await wait())) {
        setIdle()
        return false
      }

      const messageID = Identifier.ascending("message")
      // FORK 2026-09-18:/command 与 prompt 同待遇 —— 后端半死时它同样会挂住
      const files = await Promise.all(
        images.map(async (attachment) => ({
          uri: await blobDataUrl(attachment.blob, attachment.mime),
          name: attachment.filename,
        })),
      )
      await withDeliveryDeadline((signal) =>
        input.api.command(
          {
            sessionID: input.draft.sessionID,
            id: messageID,
            command: cmd,
            arguments: tail.join(" "),
            agent: input.draft.agent,
            model: {
              id: input.draft.model.modelID,
              providerID: input.draft.model.providerID,
              variant: input.draft.variant,
            },
            files,
          },
          { signal },
        ),
        input.deliveryTimeoutMs,
      )
      return true
    } catch (err) {
      setIdle()
      throw err
    }
  }

  const messageID = input.messageID ?? Identifier.ascending("message")
  const encodedImages = await Promise.all(
    images.map(async (attachment) => ({
      ...attachment,
      dataUrl: await blobDataUrl(attachment.blob, attachment.mime),
    })),
  )
  const { requestParts, optimisticParts } = buildRequestParts({
    prompt: input.draft.prompt,
    context: input.draft.context,
    images: encodedImages,
    text,
    sessionID: input.draft.sessionID,
    messageID,
    sessionDirectory: input.draft.sessionDirectory,
  })

  const message: Message = {
    id: messageID,
    sessionID: input.draft.sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: input.draft.agent,
    model: { ...input.draft.model, variant: input.draft.variant },
  }

  const add = () =>
    input.sync.session.optimistic.add({
      directory: input.draft.sessionDirectory,
      sessionID: input.draft.sessionID,
      message,
      parts: optimisticParts,
    })

  const remove = () =>
    input.sync.session.optimistic.remove({
      directory: input.draft.sessionDirectory,
      sessionID: input.draft.sessionID,
      messageID,
    })

  batch(() => {
    setBusy()
    add()
  })

  try {
    if (!(await wait())) {
      batch(() => {
        setIdle()
        remove()
      })
      return false
    }

    // FORK: REQ-100 ④ —— 送达超时闸,详见文件头 PROMPT_DELIVERY_TIMEOUT_MS 与 withDeliveryDeadline。
    //   2026-09-18 第三轮 review:这里原是与 helper **逐行重复**的内联实现,
    //   commit message 却已声称"抽成 helper 三处同待遇" —— 现在改成真的共用一份。
    const sendPrompt = (signal: AbortSignal) =>
      input.api.prompt({
      sessionID: input.draft.sessionID,
      id: messageID,
      agent: input.draft.agent,
      model: input.draft.model,
      variant: input.draft.variant,
      legacyParts: requestParts,
      text: requestParts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
      files: requestParts.flatMap((part) => {
        if (part.type !== "file") return []
        const text = part.source?.text
        return [
          {
            uri: part.url,
            name: part.filename,
            mention: text ? { start: text.start, end: text.end, text: text.value } : undefined,
          },
        ]
      }),
      agents: requestParts.flatMap((part) =>
        part.type === "agent"
          ? [
              {
                name: part.name,
                mention: part.source
                  ? { start: part.source.start, end: part.source.end, text: part.source.value }
                  : undefined,
              },
            ]
          : [],
      ),
    }, { signal })
    await withDeliveryDeadline(sendPrompt, input.deliveryTimeoutMs)
    return true
  } catch (err) {
    batch(() => {
      setIdle()
      remove()
    })
    // 送达超时已由 withDeliveryDeadline 归一成 PromptNotDeliveredError,
    // 上层据此出"这条可能没发出去"而不是通用的"发送失败"。
    throw err
  }
}

type PromptSubmitInput = {
  prompt: ReturnType<typeof usePrompt>
  info: Accessor<{ id: string } | undefined>
  imageAttachments: Accessor<ImageAttachmentPart[]>
  commentCount: Accessor<number>
  /** FORK: 可提交判定用的上下文项计数(含无注释的附件/选区卡)
   *  [feat: release-closeout-2026-09] 2026-09-17 */
  contextCount: Accessor<number>
  autoAccept: Accessor<boolean>
  mode: Accessor<"normal" | "shell">
  working: Accessor<boolean>
  editor: () => HTMLDivElement | undefined
  queueScroll: () => void
  promptLength: (prompt: Prompt) => number
  addToHistory: (prompt: Prompt, mode: "normal" | "shell") => void
  resetHistoryNavigation: () => void
  setMode: (mode: "normal" | "shell") => void
  setPopover: (popover: "at" | "slash" | null) => void
  newSessionWorktree?: Accessor<string | undefined>
  onNewSessionWorktreeReset?: () => void
  shouldQueue?: Accessor<boolean>
  onQueue?: (draft: FollowupDraft) => void
  onAbort?: () => void
  onSubmit?: () => void
  model?: ModelSelection
}

type CommentItem = {
  path: string
  selection?: FileSelection
  comment?: string
  commentID?: string
  // FORK: 从 Tauri 迁回 quote 子分类 [feat: 聊天选区-卡片化-换行] 2026-06-14
  commentOrigin?: "review" | "file" | "quote"
  preview?: string
  kind?: "chat" | "file"
}


export function createPromptSubmit(input: PromptSubmitInput) {
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const local = useLocal()
  const permission = usePermission()
  const prompt = input.prompt
  const layout = useLayout()
  const language = useLanguage()
  const params = useParams()
  const [search] = useSearchParams<{ draftId?: string }>()
  const tabs = useTabs()
  const pendingKey = (sessionID: string) => ScopedKey.from(sdk().scope, sessionID)

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "message" in err && typeof err.message === "string") return err.message
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const abort = async () => {
    const sessionID = params.id
    if (!sessionID) return Promise.resolve()

    serverSync().session.set("todo", sessionID, [])

    input.onAbort?.()

    const key = pendingKey(sessionID)
    const queued = pending.get(key)
    if (queued) {
      queued.abort.abort()
      queued.cleanup()
      pending.delete(key)
      return Promise.resolve()
    }
    // FORK-BEGIN: REQ-100 ① 停止键本地超时兜底 [feat: release-closeout-2026-09] 2026-09-17
    // 原行为:点停止后纯等后台,自己不置 idle。后台健康时没问题(事件流很快回 idle);
    // 后台半死时就成了"幻影 spinner" —— 2026-08-18 真机实测卡 ≥38 分钟、横跨一次后端 respawn。
    // 兜底语义:点了停止后 STOP_FALLBACK_IDLE_MS 内后台还没把状态改过来,前端自己置 idle。
    // 这不是"假装停下了":用户的意图就是停;后端即便还在跑,重连/周期对账(server-sync.tsx 的
    // session.status() 全量)会把真实状态盖回来 —— 兜底只负责让按钮别永久转圈。
    // 与 REQ-049 那条 toast 是两条独立路径:那条告知"请求没送达",这条兜底"状态不复位"。
    // 读写都走 sync()(session.tsx:1009 的 spinner 就读这个 store),与下方 command 路径一致。
    cancelStopFallback(sessionID)
    stopFallbackTimers.set(
      sessionID,
      setTimeout(() => {
        stopFallbackTimers.delete(sessionID)
        if (sync().data.session_status[sessionID]?.type !== "busy") return
        sync().set("session_status", sessionID, { type: "idle" })
      }, STOP_FALLBACK_IDLE_MS),
    )
    // FORK-END

    return sdk()
      .api.session.interrupt({
        sessionID,
      })
      .catch((error) => {
        // FORK: REQ-049 L3 — 后台不可达时停止请求静默失败,用户点停止「空转」没反馈;
        //   如实提示 + 依赖看门狗 respawn 后 heal-interrupted 自愈复位 [feat: sidecar-oom-brake] 2026-08-02
        //   (2026-08-11 sync v1.18.16:API 随上游 abort→interrupt)
        if (isBackendUnreachableError(error)) {
          showToast({
            variant: "error",
            title: "停止请求未送达:AI 后台服务未响应",
            description: "后台正在自动恢复,恢复后此任务状态会自动复位,请稍候。",
          })
        }
      })
  }

  const restoreCommentItems = (
    target: ReturnType<ReturnType<typeof usePrompt>["capture"]>,
    items: (ContextItem & { key: string })[],
  ) => {
    for (const item of items) {
      target.context.add(commentRestorePayload(item))
    }
  }

  const clearContext = (target: ReturnType<ReturnType<typeof usePrompt>["capture"]>) => {
    for (const item of target.context.items()) {
      target.context.remove(item.key)
    }
  }

  const seed = (dir: string, info: Session) => {
    serverSync().session.remember(info)
    const [, setStore] = serverSync().child(dir)
    setStore("session", (list: Session[]) => {
      const result = Binary.search(list, info.id, (item) => item.id)
      const next = [...list]
      if (result.found) {
        next[result.index] = info
        return next
      }
      next.splice(result.index, 0, info)
      return next
    })
  }

  const handleSubmit = async (event: Event) => {
    event.preventDefault()

    const target = prompt.capture()
    const submission = createPromptSubmissionState({
      target,
      prompt: target.current(),
      context: target.context.items().slice(),
    })
    const currentPrompt = submission.prompt
    const context = submission.context
    const text = currentPrompt.map((part) => ("content" in part ? part.content : "")).join("")
    const images = input.imageAttachments().slice()
    const mode = input.mode()

    // FORK: 由 commentCount 改为 contextCount —— 没填注释的选区卡/附件卡同样算「有东西可发」
    //   [feat: release-closeout-2026-09] 2026-09-17
    if (text.trim().length === 0 && images.length === 0 && input.contextCount() === 0) {
      if (input.working()) void abort()
      return
    }

    const modelSelection = input.model ?? local.model
    const currentModel = modelSelection.current()
    const currentAgent = local.agent.current()
    const variant = modelSelection.variant.current()
    if (!currentModel || !currentAgent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    input.addToHistory(currentPrompt, mode)
    input.resetHistoryNavigation()

    const projectDirectory = sdk().directory
    const permissionState = permission.currentServerState()
    const isNewSession = !params.id
    const shouldAutoAccept = isNewSession && input.autoAccept()
    const worktreeSelection = input.newSessionWorktree?.() || "main"

    let sessionDirectory = projectDirectory
    let client = sdk().client

    if (isNewSession) {
      if (worktreeSelection === "create") {
        const createdWorktree = await client.worktree
          .create({ directory: projectDirectory })
          .then((x) => x.data)
          .catch((err) => {
            showToast({
              title: language.t("prompt.toast.worktreeCreateFailed.title"),
              description: errorMessage(err),
            })
            return undefined
          })

        if (!createdWorktree?.directory) {
          showToast({
            title: language.t("prompt.toast.worktreeCreateFailed.title"),
            description: language.t("common.requestFailed"),
          })
          return
        }
        WorktreeState.pending(sdk().scope, createdWorktree.directory)
        sessionDirectory = createdWorktree.directory
      }

      if (worktreeSelection !== "main" && worktreeSelection !== "create") {
        sessionDirectory = worktreeSelection
      }

      if (sessionDirectory !== projectDirectory) {
        client = sdk().createClient({
          directory: sessionDirectory,
          throwOnError: true,
        })
        serverSync().child(sessionDirectory)
      }

      input.onNewSessionWorktreeReset?.()
    }

    let session = input.info()
    if (!session && isNewSession) {
      const created = await sdk()
        .api.session.create({
          agent: currentAgent.name,
          model: { id: currentModel.id, providerID: currentModel.provider.id, variant },
          location: { directory: sessionDirectory },
        })
        .then(normalizeSessionInfo)
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.sessionCreateFailed.title"),
            description: errorMessage(err),
          })
          return undefined
        })
      if (created) {
        seed(sessionDirectory, created)
        session = created
        await startTransition(() => {
          if (!session) return
          if (shouldAutoAccept) permissionState.enableAutoAccept(session.id, sessionDirectory)
          local.session.promote(sessionDirectory, session.id, {
            agent: currentAgent.name,
            model: { providerID: currentModel.provider.id, modelID: currentModel.id },
            variant: variant ?? null,
          })
          layout.handoff.setTabs(base64Encode(sessionDirectory), session.id)
          const draftID = search.draftId
          if (draftID) tabs.promoteDraft(draftID, { server: tabs.draft(draftID).server, sessionId: session.id })
          else navigate(`/${base64Encode(sessionDirectory)}/session/${session.id}`)
          submission.retarget(prompt.capture({ dir: base64Encode(sessionDirectory), id: session.id }))
        })
      }
    }
    if (!session) {
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: language.t("prompt.toast.promptSendFailed.description"),
      })
      return
    }

    const model = {
      modelID: currentModel.id,
      providerID: currentModel.provider.id,
    }
    const agent = currentAgent.name
    const draft: FollowupDraft = {
      sessionID: session.id,
      sessionDirectory,
      prompt: currentPrompt,
      context,
      agent,
      model,
      variant,
    }

    const clearInput = () => {
      submission.clear()
      input.setMode("normal")
      input.setPopover(null)
    }

    const restoreInput = () => {
      const restored = submission.restore()
      if (!restored) return false
      restored.target.set(restored.prompt, input.promptLength(restored.prompt))
      if (!submission.current(prompt.capture())) return true
      input.setMode(mode)
      input.setPopover(null)
      requestAnimationFrame(() => {
        const editor = input.editor()
        if (!editor) return
        editor.focus()
        setCursorPosition(editor, input.promptLength(currentPrompt))
        input.queueScroll()
      })
      return true
    }

    if (!isNewSession && mode === "normal" && input.shouldQueue?.()) {
      input.onQueue?.(draft)
      clearContext(submission.target())
      clearInput()
      return
    }

    // FORK: 新一轮发送 —— 撤掉上一轮「停止」留下的兜底定时器,否则它会在 4s 后
    //   把这条**新消息**打成 idle。 [feat: release-closeout-2026-09] 2026-09-18
    //
    // 🔴 2026-09-18 第三轮 review:首版把这行放在函数**前部**(队列分支之前),于是
    //   [bug-repro: 后端半死时点停止(interrupt 不回包)→ 4s 兜底已武装 → 4 秒内再输入一条 →
    //    因状态仍 busy 命中 shouldQueue → 但兜底**已被提前撤销** → 状态永久停在 busy →
    //    而队列排干的前提正是 !busy → 消息卡在队列里永不发出,spinner 永不停。]
    //   修复前兜底会在 4s 后置 idle 并把队列排干,所以那是**本批修复自己引入的回归、且比原 bug 更重**。
    //   位置即语义:只有"这一发真的要出去了"才该撤销兜底 —— 走队列的那条并没有发出去。
    if (params.id) cancelStopFallback(params.id)

    input.onSubmit?.()

    if (mode === "shell") {
      clearInput()
      const eventID = Event.ID.create()
      sdk()
        .api.session.shell({
          sessionID: session.id,
          id: eventID,
          command: text,
          agent,
          model,
        })
        .catch((err) => {
          showToast({
            title: language.t("prompt.toast.shellSendFailed.title"),
            description: errorMessage(err),
          })
          restoreInput()
        })
      return
    }

    if (text.startsWith("/")) {
      const [cmdName, ...args] = text.split(" ")
      const commandName = cmdName.slice(1)
      const customCommand = sync().data.command.find((c) => c.name === commandName)
      if (customCommand) {
        clearInput()
        const messageID = Identifier.ascending("message")
        serverSync().session.set("session_status", session.id, { type: "busy" })
        const files = await Promise.all(
          images.map(async (attachment) => ({
            uri: await blobDataUrl(attachment.blob, attachment.mime),
            name: attachment.filename,
          })),
        )
        // 🔴 2026-09-18 第三轮 review:这条**主** /command 路径此前是裸 `.catch`,完全没有送达超时 ——
        //   commit message 声称的"三处同待遇"实际只落在 sendFollowupDraft 那一处。
        //   [bug-repro: 后端半死(socket 开着但永不响应)时请求永不 settle → `.catch` 永不触发 →
        //    上面已经 clearInput() 且置了 busy → **用户输入的斜杠命令连同附件直接蒸发、状态永久 busy**。
        //    这正是 REQ-100 ④ 要消灭的那种形态,却在它自己的主路径上原封不动。]
        withDeliveryDeadline((signal) =>
          sdk().api.session.command(
            {
              sessionID: session.id,
              id: messageID,
              command: commandName,
              arguments: args.join(" "),
              agent,
              model: { id: model.modelID, providerID: model.providerID, variant },
              files,
            },
            { signal },
          ),
        ).catch((err) => {
          serverSync().session.set("session_status", session.id, { type: "idle" })
          const restored = restoreInput()
          // 未送达与"后端明确报错"处置不同:前者不能说死"没发出去"(服务端可能已 admit 只是回包慢),
          // 与 prompt 路径共用同一组已打磨的文案。
          const notDelivered = isPromptNotDelivered(err)
          showToast({
            variant: notDelivered ? "error" : undefined,
            title: language.t(
              notDelivered ? "prompt.toast.promptNotDelivered.title" : "prompt.toast.commandSendFailed.title",
            ),
            description: notDelivered
              ? language.t(
                  restored
                    ? "prompt.toast.promptNotDelivered.description"
                    : "prompt.toast.promptNotDelivered.inputBusy.description",
                )
              : formatServerError(err, language.t, language.t("common.requestFailed")),
          })
        })
        return
      }
    }

    // FORK-BEGIN: 发送后清空**所有** file 上下文项,不只有注释的那些
    //   [feat: release-closeout-2026-09] 2026-09-17
    //   原先只清「有注释」的,于是没填注释的选区卡/附件卡发完仍留在输入框。表面是「卡片没消失」,
    //   真正的代价是它**还在 context 里** —— 下一条消息会把同一个文件再发给模型一次,
    //   用户看不出来,白烧 token。与 REQ-116 修过的是同一族(那次只修了新会话 retarget 那一支,
    //   已有会话这一支没修);queue 分支的 clearContext 本来就是全清,此处与之对齐。
    //   失败回吐时 restoreCommentItems 会把它们原样还回来,语义不变。
    const commentItems = clearableContextItems(context)
    // FORK-END
    const messageID = Identifier.ascending("message")

    const removeOptimisticMessage = () => {
      sync().session.optimistic.remove({
        directory: sessionDirectory,
        sessionID: session.id,
        messageID,
      })
    }

    for (const item of commentItems) submission.target().context.remove(item.key)
    clearInput()

    const waitForWorktree = async () => {
      const worktree = WorktreeState.get(sdk().scope, sessionDirectory)
      if (!worktree || worktree.status !== "pending") return true

      if (sessionDirectory === projectDirectory) {
        sync().set("session_status", session.id, { type: "busy" })
      }

      const controller = new AbortController()
      const cleanup = () => {
        if (sessionDirectory === projectDirectory) {
          sync().set("session_status", session.id, { type: "idle" })
        }
        removeOptimisticMessage()
        // FORK 2026-09-19 发版前 review:与下方 catch 分支同源 ——
        // [bug-repro: 原先写成 `if (restoreInput()) restoreCommentItems(...)`。等 worktree 期间点停止时
        //  输入框早已被 clearInput() 清空,用户很可能已开始打新内容 → restoreInput() 返 false →
        //  整个分支短路,引用卡/附件卡**就地蒸发且无任何提示**。
        //  本批已在 catch 分支修掉同一形态并写明理由,这条兄弟路径漏改。]
        // 引用卡是**追加**语义、不覆盖正文,所以无论原文还不还得回去,卡都要还。
        restoreInput()
        restoreCommentItems(submission.target(), commentItems)
      }

      pending.set(pendingKey(session.id), { abort: controller, cleanup })

      const abortWait = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        if (controller.signal.aborted) {
          resolve({ status: "failed", message: "aborted" })
          return
        }
        controller.signal.addEventListener(
          "abort",
          () => {
            resolve({ status: "failed", message: "aborted" })
          },
          { once: true },
        )
      })

      const timeoutMs = 5 * 60 * 1000
      const timer = { id: undefined as number | undefined }
      const timeout = new Promise<Awaited<ReturnType<typeof WorktreeState.wait>>>((resolve) => {
        timer.id = window.setTimeout(() => {
          resolve({
            status: "failed",
            message: language.t("workspace.error.stillPreparing"),
          })
        }, timeoutMs)
      })

      const result = await Promise.race([
        WorktreeState.wait(sdk().scope, sessionDirectory),
        abortWait,
        timeout,
      ]).finally(() => {
        if (timer.id === undefined) return
        clearTimeout(timer.id)
      })
      pending.delete(pendingKey(session.id))
      if (controller.signal.aborted) return false
      if (result.status === "failed") throw new Error(result.message)
      return true
    }

    void sendFollowupDraft({
      api: sdk().api.session,
      sync: sync(),
      serverSync: serverSync(),
      draft,
      messageID,
      optimisticBusy: sessionDirectory === projectDirectory,
      before: waitForWorktree,
    }).catch((err) => {
      pending.delete(pendingKey(session.id))
      if (sessionDirectory === projectDirectory) {
        sync().set("session_status", session.id, { type: "idle" })
      }
      // FORK-BEGIN: REQ-100 ④ 失败处置分流 [feat: release-closeout-2026-09] 2026-09-17
      // 三件事必须一起发生,顺序不能反:
      //   ① 撤下乐观挂上的那条消息 —— 不能既留在时间线又回到输入框(用户会以为发了两条)
      //   ② 原文 + 引用卡片原样还原进输入框
      //   ③ toast 说清"没发出去、东西还在你手里"(D-C 拍板的语义)
      removeOptimisticMessage()

      // restoreInput() 返 false = 用户在失败前已另起输入,原文不覆盖(不能抢用户正在打的字)。
      // 但引用卡片是**追加**语义、不覆盖正文,所以无论如何都还回去 ——
      // 原先写成 `if (restoreInput()) restoreCommentItems(...)`,这一支下引用卡片会就地蒸发且无提示。
      const restored = restoreInput()
      restoreCommentItems(submission.target(), commentItems)

      const notDelivered = isPromptNotDelivered(err)
      showToast({
        variant: notDelivered ? "error" : undefined,
        title: language.t(
          notDelivered ? "prompt.toast.promptNotDelivered.title" : "prompt.toast.promptSendFailed.title",
        ),
        description: notDelivered
          ? language.t(
              restored
                ? "prompt.toast.promptNotDelivered.description"
                : "prompt.toast.promptNotDelivered.inputBusy.description",
            )
          : errorMessage(err),
      })
      // FORK-END
    })
  }

  return {
    abort,
    handleSubmit,
  }
}
