// [fork-only] message-pipeline — 飞书消息 → opencode plugin client → 飞书回写
// [feat: feishu-bridge] 2026-05-09 v3(plugin 模式)
//
// v3 切到 opencode plugin 架构(对齐 OpenClaw channel plugin):
//   - opencodeClient 来自 PluginInput.client(in-process,自动 attach instance)
//   - LLM 响应通过 PromptDispatcher(plugin event hook 推送),不再手写 SSE
//   - 0 修改 opencode / DeskFox 主程序
//
// 流程:
//   1. WSS 收到 ImMessageEvent(messageType="text")
//   2. 解析 text + chatId → opencode session map(threadSession 1:1)
//   3. opencodeClient.session.create({ title })— 首次
//   4. dispatcher.register(sessionID) → 拿到 reply Promise
//   5. opencodeClient.session.promptAsync({ sessionID, agent, parts })
//   6. await replyPromise(dispatcher 累积 token,session.idle 时 resolve)
//   7. lark Client.im.v1.message.create 发回飞书

import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Client } from "@larksuiteoapi/node-sdk"
import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { FeishuAccount } from "../core/config-schema"
import { readSecret } from "../core/secret-ref"
import type { ChatSessionStore } from "./chat-session-store"
import {
  ConfirmCardController,
  type ParsedConfirmAction,
} from "./confirm-card"
import { createGroup, getShareLink } from "./group-creator"
import {
  PermissionCardController,
  type ParsedCardAction,
  type PermissionRequest,
} from "./permission-card"
import {
  getClientAuthContext,
  sendFileMessage,
  sendImageMessage,
  uploadFile,
  uploadImage,
} from "./file-uploader"
import { downloadFeishuImage } from "./image-downloader"
import { fetchMergeForwardItems } from "./merge-forward-fetcher"
import {
  flattenMergeForward,
  MAX_NEST_DEPTH,
  MAX_SUB_MESSAGES,
  type SubMessage,
} from "./merge-forward-flatten"
import type { PromptDispatcher } from "./prompt-dispatcher"
// FORK: REQ-035 文件内容抽取 2026-06-02 / PDF 2026-06-03 / xlsx+pptx+image 2026-06-03
import {
  detectFileFormat,
  extractPdfTextAsync,
  extractTextFromBuffer,
  getImageMime,
} from "./file-content-extractor"

// FORK-BEGIN: REQ-035 文件路径注入辅助函数 2026-06-03
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function getFormatDisplay(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  return dot === -1 ? "文件" : fileName.slice(dot + 1).toUpperCase()
}
// FORK-END
import {
  classifyAttachment,
  GROUP_NAME_MAX_LEN,
  isBotMentioned,
  isGroupCreationIntent,
  parseAttachMarkers,
  parseGroupCommand,
  stripMentions,
} from "./reply-actions"
import type { ImMessageEvent } from "./wss-client"

/** opencode SDK v1 client 类型(plugin PluginInput.client 类型) */
export type OpencodeSDKClient = ReturnType<typeof createOpencodeClient>

/** [feat: feishu-image-recognition] 2026-05-26
 *  vision capability 缓存 TTL — 10 min,导出供单测覆盖 */
export const VISION_CAP_TTL_MS = 10 * 60 * 1000

/** vision cache entry 是否仍然新鲜(未过 TTL)*/
export function isVisionCacheFresh(
  entry: { checkedAt: number } | undefined,
  now: number = Date.now(),
  ttl: number = VISION_CAP_TTL_MS,
): boolean {
  return !!entry && now - entry.checkedAt < ttl
}

/**
 * 从 opencodeClient.config.providers() 的 raw response 抽 vision support。
 * 纯函数,U2/U3/U4 直接覆盖(helper extract 模式,绕开 class 私有方法 + opencode RPC mock)。
 *
 * - 拿不到 providers 数组 → 默认 true(放行,假设支持,让 LLM 自己回错)
 * - provider/model 找不到 → false(明确不支持)
 * - model.capabilities.input.image === true → true
 * - 其它情况 → false
 */
export function extractVisionSupport(
  providersResponse: unknown,
  providerID: string,
  modelID: string,
): boolean {
  const providers = (
    providersResponse as {
      providers?: Array<{
        id: string
        models: Record<string, { capabilities?: { input?: { image?: boolean } } }>
      }>
    } | null | undefined
  )?.providers
  if (!providers) return true
  const provider = providers.find((p) => p.id === providerID)
  const modelInfo = provider?.models?.[modelID]
  return modelInfo?.capabilities?.input?.image === true
}

/** [feat: feishu-image-recognition] 2026-05-26
 *  飞书 IM 消息 content 解析结果(handle() 处理 text/image/post 时复用)*/
export interface ParsedContent {
  text: string
  imageKey: string | null
}

/**
 * 解析飞书 IM 消息 content JSON。支持 text/image/post 三种 messageType。
 *
 * - text:`{ text: "..." }`
 * - image:`{ image_key: "img_v3_...", text?: "caption" }`(image event 偶尔含 caption)
 * - post:`{ title?, content: [[{tag:"text"|"img", text?, image_key?}, ...], ...] }`
 *   - 富文本嵌套:title + N 段 paragraph,每段 N 个 segment(text 段 / img 段)
 *   - flatten 所有 text 段拼单字符串(空格 join)
 *   - 首张图取 image_key(本期不支持多图,后续 D3 backlog)
 *   - 兼容 SDK 用 "img" 或 "image" 标识图片段
 *
 * 解析失败抛 SyntaxError(由 JSON.parse 抛)— 调用方 catch 后跳过该消息。
 * shape 不符合预期(如 messageType=post 但 content 不是 post)→ 返默认空值。
 */
export function parseMessageContent(
  messageType: string,
  contentJson: string,
): ParsedContent {
  if (messageType === "text") {
    const parsed = JSON.parse(contentJson) as { text?: string }
    return { text: (parsed.text ?? "").trim(), imageKey: null }
  }
  if (messageType === "image") {
    const parsed = JSON.parse(contentJson) as { image_key?: string; text?: string }
    return {
      text: (parsed.text ?? "").trim(),
      imageKey: parsed.image_key ?? null,
    }
  }
  if (messageType === "post") {
    const parsed = JSON.parse(contentJson) as {
      title?: string
      content?: Array<Array<{ tag?: string; text?: string; image_key?: string }>>
    }
    const textParts: string[] = []
    if (parsed.title) textParts.push(parsed.title)
    let imageKey: string | null = null
    for (const para of parsed.content ?? []) {
      if (!Array.isArray(para)) continue
      for (const seg of para) {
        if (!seg || typeof seg !== "object") continue
        if (seg.tag === "text" && typeof seg.text === "string" && seg.text)
          textParts.push(seg.text)
        if ((seg.tag === "img" || seg.tag === "image") && typeof seg.image_key === "string" && !imageKey)
          imageKey = seg.image_key
      }
    }
    return { text: textParts.join(" ").trim(), imageKey }
  }
  // 其它 messageType — caller 已 skip 不该到这,兜底返空值
  return { text: "", imageKey: null }
}

// FORK-BEGIN: REQ-036 引用/回复原文 2026-06-02
/**
 * 拉取飞书引用/回复的原消息文本。失败或取不到时返 null(调用方 graceful 降级)。
 *
 * 架构注意:本函数结果以 text part 注入用户消息,**非 system prompt**,因此对所有
 * opencode agent(imbot / build / claude-code plugin 等)均有效,不依赖 system prompt
 * 是否被 agent 读取。
 *
 * 消息类型映射:
 *   text / post → 抽取文本;image(纯图无 caption)→ "[图片]"
 *   file → "[文件:{file_name}]";其他 → "[{msg_type}]"
 */
export async function fetchParentMessageText(
  parentId: string,
  larkClient: Client,
  timeoutMs = 10_000,
): Promise<string | null> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    const h = setTimeout(() => reject(new Error("timeout")), timeoutMs)
    if (typeof (h as { unref?: () => void }).unref === "function")
      (h as { unref: () => void }).unref()
  })
  let response: unknown
  try {
    response = await Promise.race([
      larkClient.im.v1.message.get({ path: { message_id: parentId } }),
      timeoutPromise,
    ])
  } catch {
    return null
  }
  const items = (
    response as {
      data?: { items?: Array<{ msg_type?: string; body?: { content?: string } }> }
    }
  )?.data?.items
  const msg = items?.[0]
  if (!msg) return null

  const msgType = msg.msg_type ?? ""
  const content = msg.body?.content ?? ""

  if (msgType === "text" || msgType === "image" || msgType === "post") {
    try {
      const parsed = parseMessageContent(msgType, content)
      if (parsed.text) return parsed.text
      if (parsed.imageKey) return "[图片]"
      return null
    } catch {
      return null
    }
  }
  if (msgType === "file") {
    try {
      const parsed = JSON.parse(content) as { file_name?: string }
      const name = parsed.file_name ? `:${parsed.file_name}` : ""
      return `[文件${name}]`
    } catch {
      return "[文件]"
    }
  }
  return msgType ? `[${msgType}]` : "[消息]"
}
// FORK-END

/**
 * 飞书桥接专用 workspace directory — 所有 plugin 创建的 session 都在这个
 * 目录下,跟 user 主窗口的项目隔离。GUI sidebar 不会显示(因为 archive),
 * 也不污染 user 实际项目环境。
 */
const IMBOT_WORKSPACE = join(homedir(), ".opencode", "imbot-workspace")

const FEISHU_OPEN_API_DOMAIN: Record<"feishu" | "lark", string> = {
  feishu: "https://open.feishu.cn",
  lark: "https://open.larksuite.com",
}

/**
 * 飞书 session 专属 system prompt — 跟 build agent 自带的 system 拼接(opencode 行为)。
 *
 * 用途:禁用 LLM 的"反问 user"工具(`question` / `ask-user-question` 等),避免 agent
 * loop 调这类工具后**永远卡死等不到回答**(飞书无 GUI 接收 question 的 form 输入)。
 *
 * 真互动(form 卡片 + synthetic message)是 OpenClaw 对齐 roadmap 的 #5,Large 后续做。
 * 本 system prompt 是临时止血,2026-05-10 立。
 */
const FEISHU_SESSION_SYSTEM_PROMPT_BASE = [
  "本会话通过飞书 / Lark 桥接,你跟用户之间没有 GUI 交互层。",
  "**禁止**调用任何反问用户类工具(question / ask-user-question / askUser / clarify 等),",
  "因为用户在飞书 IM 看不到这些问题,会导致 agent loop 永远卡住。",
  "",
  "遇到信息不足或语义模糊时,请**直接做以下任一**:",
  "1. 基于现有信息和你的最佳判断给出答案;",
  "2. 在回复里明确写「需要补充以下信息:...」请用户重发新消息;",
  "3. 短答 + 列出可选方向让用户挑(纯文本即可,不要用工具)。",
  "",
  "其他工具(file 操作 / shell / bash / read 等)不受此限制,正常使用。",
].join("\n")

/**
 * [feat: feishu-bridge-light] ATTACH marker 协议 — 教 LLM 怎么把本地文件发回飞书。
 * 始终启用(无 opt-in 配置 — 路径白名单 + size 限制已足够安全)。
 */
const ATTACH_MARKER_PROMPT = [
  "## 文件回传协议",
  "需要把本地图片/文档发给用户时,在回复里嵌入 marker:",
  "  `[ATTACH:/abs/path/to/file.ext]`",
  "系统会自动上传到飞书并 strip 掉这个 marker(用户看不到 marker,只看到文件)。",
  "",
  "约束:",
  "- 路径必须是绝对路径,且在 `~/.opencode/imbot-workspace/` 子树内(写文件请用这个目录)",
  "- 图片(jpg/png/gif/webp/bmp/tiff/ico)≤ 10MB",
  "- 文件(pdf/doc/xls/ppt/mp4/opus)≤ 30MB,其它扩展名(docx/xlsx/txt/md/zip 等)走 stream 兜底",
  "- 一次回复可嵌多个 marker,系统按出现顺序处理",
].join("\n")

/**
 * [feat: feishu-group-slash-command] 2026-05-24
 * 建群引导 — 教 LLM 用户表达建群意图时回复"请用 /group <群名>",不再 emit marker。
 *
 * 替换了 v1 的 CREATE_GROUP_MARKER_PROMPT([CREATE_GROUP:name] 协议)和 v2 的
 * CREATE_GROUP_DISABLED_PROMPT(flag=false 时禁令)。
 *
 * 设计:flag 状态不再影响 system prompt — 任何 flag 状态下 LLM 都引导用户用 /group。
 * /group 路径本身在 pipeline.handle() 层处理(0 LLM 调用),flag=false 时 user 用
 * /group 仍能建群(slash command 显式触发,绕过 flag);flag=true 时让 LLM 自动建群的
 * 老能力被砍掉(LLM marker 路径已删,这是 user 拍板的 tradeoff:0 LLM 漂移)。
 *
 * **provider-agnostic 兜底**:跳过 system prompt 的 provider(claude-code 等)看不到这段,
 * 但 pipeline 入口层的 isGroupCreationIntent 白名单会拦住自然语言建群请求并 reply 引导,
 * user 仍能学会用 /group。
 */
const GROUP_CREATION_GUIDE_PROMPT = [
  "## 建群引导",
  "如果用户表达建群意图(例如'帮我建群' / '把刚才内容拉个群继续' / 'create a group for X'),",
  "**不要尝试自己建群**,请回复用户使用斜杠命令:",
  "",
  "  `/group <群名>`",
  "",
  "例:`/group 项目讨论`。让用户自己决定是否触发建群。",
  "",
  "**不要**尝试通过其他途径建群 — 不要读源码 / 不要调飞书 SDK / 不要装 MCP / 不要找替代方案,",
  "**不要**让用户提供飞书 appId/appSecret/token 等凭证。",
].join("\n")

/**
 * 给飞书 user 的友好错误回复 — 把技术性 opencode error message 翻译成 user 可操作的指引。
 * 只识别 happy-path 阻塞性错误(没配 default model / provider key 无效),其他原样返回。
 *
 * 触发关键字来源(opencode source verified 2026-05-10):
 *   - "no providers found"  → packages/opencode/src/provider/provider.ts:1706
 *   - "no models found"     → packages/opencode/src/provider/provider.ts:1708
 *   - "Invalid model"       → CLI/github.ts;形态 `Invalid model ${x}. Model must be ...`
 *   - "API key"             → upstream provider SDK 抛 401 时常含 "API key" / "api key"
 *
 * exported for unit testing.
 */

/**
 * [feat: feishu-llm-timeout-surface] 2026-06-01 — handle() / handleMergeForward()
 * 收到 finalText.trim()==="" 时的兜底文案。
 *
 * AC2 之后 runOpencode 已经把"无输出"路径全 throw,理论上 finalText 不会为空。
 * 但 processAttachments 可能把含 [ATTACH:xxx] 的 reply 处理完后剩纯空白(罕见,
 * LLM 只返了 ATTACH marker),这时仍走兜底防御,不能让 sendFeishuText 收到空 string
 * (飞书 API 报错)也不能静默丢弃。
 */
export const EMPTY_REPLY_FALLBACK =
  "🤔 LLM 返回了空内容(可能正在思考 / 网络中断 / provider 链路异常)。请稍后再试,或在 DeskFox 主程序里换 model。"

export function friendlyErrorReply(err: Error): string {
  const msg = err.message ?? String(err)
  const lower = msg.toLowerCase()
  if (
    lower.includes("no providers found") ||
    lower.includes("no models found") ||
    lower.includes("no model configured") ||
    lower.includes("invalid model")
  ) {
    return (
      "❌ DeskFox 未配置默认 LLM model。\n" +
      "请打开 DeskFox 主程序 → Settings → Providers,给任一 provider 添加 API key,build agent 默认 model 会自动设置好。\n" +
      `(原始错误:${msg})`
    )
  }
  if (lower.includes("api key") || lower.includes("api_key") || lower.includes("401")) {
    return (
      "❌ DeskFox 调用 LLM 失败 — API key 可能无效或额度不足。\n" +
      "请到 DeskFox 主程序 → Settings → Providers 检查对应 provider 的 key。\n" +
      `(原始错误:${msg})`
    )
  }
  // [feat: feishu-llm-timeout-surface] 2026-06-01 — 5 类新 pattern,把 runOpencode
  // 新增的 throw 路径(timeout / no-useful / session.messages 失败)+ provider HTTP
  // 错误统一翻译成 user 可操作的中文反馈。
  //
  // ⚠️ if 顺序敏感:no-useful / session-state 比 timeout 更具体,**必须放在 timeout 之前**。
  // 否则 "本轮 LLM 无 useful 输出(... 30 分钟超时降级)" 这种含"超时"两字的 error
  // 会被 timeout 分支抢先匹配。
  if (msg.includes("本轮 LLM 无 useful 输出") || msg.includes("LLM 未产出")) {
    return (
      "🤔 LLM 这轮没产出任何回复 — 可能:① 上一步权限申请被拒后模型停了 ② provider 链路异常 ③ 超时降级未来得及拉到结果。\n" +
      "建议:再发一次,或在 DeskFox 主程序里换 model。\n" +
      `(原始错误:${msg})`
    )
  }
  if (msg.includes("session.messages 读取失败") || msg.includes("session 为空")) {
    return (
      "🔌 DeskFox 内部读不到 LLM 回复(session 状态异常)。\n" +
      "这通常是 sidecar 进程问题,请重启 DeskFox 后重试。\n" +
      `(原始错误:${msg})`
    )
  }
  if (
    lower.includes("timeout") ||
    msg.includes("超时") ||
    msg.includes("无任何输出") ||
    msg.includes("30 分钟超时")
  ) {
    return (
      "⏱️ LLM 模型回复超时(默认等 30 分钟未收到完整输出)。\n" +
      "常见原因:模型繁忙 / provider 链路异常(如 OAuth 失效)/ 网络抖动。\n" +
      "建议:稍后重试,或在 DeskFox 主程序里换一个 model。\n" +
      `(原始错误:${msg})`
    )
  }
  if (lower.includes("rate limit") || lower.includes("ratelimit") || /\b429\b/.test(msg)) {
    return (
      "🚦 LLM provider 限速了(HTTP 429 / rate limit)。\n" +
      "等几分钟再发,或换一个 provider 试试。\n" +
      `(原始错误:${msg})`
    )
  }
  if (/\b(50[234])\b/.test(msg)) {
    return (
      "⚠️ LLM provider 暂时不可用(HTTP 5xx)。这是上游服务的问题,稍后重试即可。\n" +
      `(原始错误:${msg})`
    )
  }
  return `❌ DeskFox 处理出错:${msg}`
}

export interface PipelineOptions {
  account: FeishuAccount
  accountId: string
  /** opencode SDK v1 client(plugin PluginInput.client,in-process,自动 attach instance) */
  opencodeClient: OpencodeSDKClient
  /** event hook → waiter 路由器 */
  dispatcher: PromptDispatcher
  /** chatId → sessionID 持久化映射(plugin 重启后同 chat 仍能复用 session)*/
  chatSessionStore: ChatSessionStore
  /** 单次 prompt 超时(ms),默认 5min */
  promptTimeoutMs?: number
  /**
   * 可选注入的 lark Client(单测用 fake)。
   * 不传时按 account 配置内部创建,跟 PermissionCardController 注入风格对齐。
   * [feat: feishu-bridge-light]
   */
  larkClient?: Client
  /**
   * 可选 ATTACH 路径白名单根 — 默认 ~/.opencode/imbot-workspace(IMBOT_WORKSPACE)。
   * 单测用 temp 目录覆盖,避免污染真实 workspace。
   * [feat: feishu-bridge-light]
   */
  attachWorkspaceRoot?: string
  /**
   * 飞书文件磁盘存储根目录 — 默认 ~/.opencode/imbot-workspace/feishu-files。
   * 单测用 tmpDir 覆盖,避免污染真实 workspace。
   * FORK: REQ-035 2026-06-03
   */
  feishuFilesRoot?: string
}

export class MessagePipeline {
  private readonly opts: PipelineOptions
  private readonly larkClient: Client
  /** chatId → opencode sessionID(in-memory cache,真持久化在 chatSessionStore)*/
  private readonly chatToSession = new Map<string, string>()
  /** [feat: feishu-image-recognition] 2026-05-26 — model vision capability 缓存
   *  key: `<providerID>/<modelID>` 或 "__default__"(account 没指定 model)
   *  value: { supportsImage: boolean, checkedAt: ms }
   *  TTL 10 min,避免每条消息都查 /config/providers */
  private readonly visionCapCache = new Map<
    string,
    { supportsImage: boolean; checkedAt: number }
  >()
  /** sessionID → chatId 反查(用于 permission.asked 事件路由)*/
  private readonly sessionToChat = new Map<string, string>()
  /** 飞书 CardKit 权限卡片控制器(LLM 调工具触发权限时弹卡片让 user 在飞书选)*/
  readonly permissionController: PermissionCardController
  /** [feat: feishu-bridge-light] yes/no 确认卡片控制器(自动建群二次确认等)*/
  readonly confirmController: ConfirmCardController
  /** [feat: feishu-bridge-light] 单调递增 confirm requestID 计数,跟 messageId 拼成唯一 key */
  private confirmCounter = 0

  constructor(opts: PipelineOptions) {
    this.opts = opts
    if (opts.larkClient) {
      this.larkClient = opts.larkClient
    } else {
      const appSecret = readSecret(opts.account.appSecret)
      this.larkClient = new Client({
        appId: opts.account.appId,
        appSecret,
        domain: FEISHU_OPEN_API_DOMAIN[opts.account.domain],
      })
    }
    this.permissionController = new PermissionCardController({
      opencodeClient: opts.opencodeClient,
      larkClient: this.larkClient,
      workspaceDir: IMBOT_WORKSPACE,
    })
    this.confirmController = new ConfirmCardController({
      larkClient: this.larkClient,
    })
  }

  /**
   * 动态拼接 system prompt:
   * - base(总是)
   * - ATTACH marker(总是 — 路径白名单 + size 限制安全)
   * - 建群引导(总是 — 教 LLM 引导用户用 /group,不再 emit marker)
   *   [feat: feishu-group-slash-command] 2026-05-24
   */
  private getSystemPrompt(): string {
    return [
      FEISHU_SESSION_SYSTEM_PROMPT_BASE,
      ATTACH_MARKER_PROMPT,
      GROUP_CREATION_GUIDE_PROMPT,
    ].join("\n\n")
  }

  /**
   * 给 plugin 用 — 判断本 pipeline 是否拥有此 sessionID(用于 permission.asked 事件路由)。
   * 仅复用 *本 sidecar lifecycle 内* 创建的 session(in-memory cache),跟 chatToSession 同步。
   */
  hasSession(sessionID: string): boolean {
    return this.sessionToChat.has(sessionID)
  }

  /**
   * 收到 permission.asked event → 渲染卡片发到对应 chat。
   * sessionID 不属于本 pipeline 时静默 noop(plugin 应已通过 hasSession 路由,这里再防御一次)。
   */
  async handlePermissionAsked(request: PermissionRequest): Promise<void> {
    const chatId = this.sessionToChat.get(request.sessionID)
    if (!chatId) {
      console.warn(
        `[pipeline ${this.opts.accountId}] permission.asked for unknown sessionID ${request.sessionID}`,
      )
      return
    }
    await this.permissionController.start(request, chatId)
  }

  /**
   * [feat: feishu-bridge-light] 收到 confirm 卡片(yes/no)→ 路由到 ConfirmCardController。
   * plugin.ts 在 onCardAction 里先尝试 parseCardAction(permission),再 parseConfirmAction(confirm)。
   */
  async handleConfirmCardReply(parsed: ParsedConfirmAction): Promise<void> {
    await this.confirmController.handleReply(parsed)
  }

  /**
   * 收到 card.action.trigger event(WSS)→ 解析 + 路由到 controller.handleReply。
   * 不属于本 pipeline 的 card action(其他卡片 / 其他 account)静默 noop。
   */
  async handleCardActionReply(parsed: ParsedCardAction): Promise<void> {
    await this.permissionController.handleReply(parsed)
  }

  async handle(event: ImMessageEvent): Promise<void> {
    // [feat: feishu-image-recognition] 2026-05-26 — image 走多模态识别路径
    // [feat: feishu-merge-forward] 2026-05-26 — merge_forward 走拉子消息 flatten 路径
    // text=纯文字 / image=纯图 / post=富文本(图+文混合,飞书拖图+输文字默认走 post)
    // merge_forward = user 长按多条消息合并转发
    // FORK: REQ-035 2026-06-02 — file 走文本抽取路径
    // 其它(audio/video/sticker/interactive 等)留 backlog
    if (
      event.messageType !== "text" &&
      event.messageType !== "image" &&
      event.messageType !== "post" &&
      event.messageType !== "merge_forward" &&
      event.messageType !== "file"
    ) {
      console.log(
        `[pipeline ${this.opts.accountId}] skip unsupported message: type=${event.messageType}`,
      )
      return
    }

    // [feat: feishu-merge-forward] 2026-05-26 — merge_forward 走独立路径
    // (其内容 = N 条原消息嵌套,跟 text/image/post 处理流程完全不同)
    if (event.messageType === "merge_forward") {
      await this.handleMergeForward(event)
      return
    }

    // FORK-BEGIN: REQ-035 文件消息走独立路径(下载 + 抽取文本)2026-06-02
    if (event.messageType === "file") {
      await this.handleFileMessage(event)
      return
    }
    // FORK-END

    // 解析 content — text/image/post 各自 shape(helper 可单测)
    let parseResult: ParsedContent | null = null
    try {
      parseResult = parseMessageContent(event.messageType, event.content)
    } catch {
      console.warn(
        `[pipeline ${this.opts.accountId}] invalid content json for type=${event.messageType}:`,
        event.content,
      )
      return
    }

    const { text, imageKey } = parseResult

    if (event.messageType === "image" && !imageKey) {
      console.warn(`[pipeline ${this.opts.accountId}] image event 缺 image_key,skip`)
      await this.sendFeishuText(event.chatId, "😅 收到的图片好像出了点问题,换张图试试?").catch(
        () => {},
      )
      return
    }

    // [feat: feishu-image-recognition] 2026-05-26
    // 收图前先预检 model 是否支持 vision — 不支持就直接友好告知 user 不调 LLM(避免卡死在"识别中...")
    if (imageKey) {
      const visionOk = await this.checkModelVisionSupport().catch(() => true) // 查失败默认放行
      if (!visionOk) {
        const modelHint = this.opts.account.model
          ? `${this.opts.account.model.providerID}/${this.opts.account.model.modelID}`
          : "当前默认 model"
        await this.sendFeishuText(
          event.chatId,
          `⚠️ ${modelHint} 不支持图片识别。请到 DeskFox 设置 → 飞书桥接 → 选当前账号 → 编辑 → Model,换成支持视觉的模型(如 claude-code/sonnet、Claude/GPT-4o/Gemini 等)。`,
        ).catch(() => {})
        return
      }
    }

    // 下载图片(image/post 消息含图都走的分支)— 失败也继续(LLM 收到 text-only 错误说明)
    let imagePart: { mime: string; filename: string; absolutePath: string } | null = null
    let imageDownloadError: string | null = null
    if (imageKey) {
      // D5 提前发"识别中..."提示(vision LLM 5-15s 慢,无反馈用户以为没收到)
      await this.sendFeishuText(event.chatId, "🖼️ 收到图片,识别中...").catch((err) => {
        console.warn(`[pipeline ${this.opts.accountId}] 发送识别中提示失败:`, err)
      })

      try {
        const auth = await getClientAuthContext(this.larkClient)
        const dl = await downloadFeishuImage(
          imageKey,
          event.messageId,
          event.chatId,
          auth.token,
          auth.domain,
        )
        imagePart = { mime: dl.mime, filename: dl.filename, absolutePath: dl.absolutePath }
        console.log(
          `[pipeline ${this.opts.accountId}] downloaded image ${dl.size}B → ${dl.absolutePath}`,
        )
      } catch (err) {
        imageDownloadError = (err as Error).message
        console.warn(
          `[pipeline ${this.opts.accountId}] image download failed: ${imageDownloadError}`,
        )
      }
    }

    // 文本 + 图都没,直接退(image 消息无 caption + 下载失败的极端情况)
    if (!text && !imagePart && !imageDownloadError) return
    if (!text && imageDownloadError) {
      await this.sendFeishuText(
        event.chatId,
        `😅 没能下载这张图(原因:${imageDownloadError})。换张图或者跟我说说图里啥内容?`,
      ).catch(() => {})
      return
    }
    // image 消息有时 caption 也是空的(纯发图),不退;让 LLM 收图后自己判断回复

    // [feat: feishu-bridge-light] /new slash command — 清当前 chat session 切话题
    // [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25
    // 启用条件:p2p 永远允许;group 只在 requireMention=false(免@ 模式)时允许 —
    // user 主动选 channel-as-workspace 模式,清群 session 是 channel-level 共识操作。
    // 先 strip mention 再判,允许 "@bot /new" 形态。
    const cleaned = stripMentions(text, event.mentions)
    if (cleaned === "/new") {
      if (event.chatType !== "p2p" && this.opts.account.requireMention) {
        await this.sendFeishuText(
          event.chatId,
          "⚠️ 群里使用 /new 需先开启「允许 AI 免@ 读取群里所有信息」（DeskFox 设置 → 飞书桥接 → 选此账号 → 编辑 → 高级能力）",
        )
        return
      }
      const sessionID = this.chatToSession.get(event.chatId)
      this.opts.chatSessionStore.delete(this.opts.accountId, event.chatId)
      this.chatToSession.delete(event.chatId)
      if (sessionID) this.sessionToChat.delete(sessionID)
      const replyText =
        event.chatType === "p2p"
          ? "✅ 已开启新对话"
          : "✅ 已开启新对话（群 session 已清，影响所有成员）"
      await this.sendFeishuText(event.chatId, replyText)
      console.log(
        `[pipeline ${this.opts.accountId}] /new cleared session for chat=${event.chatId} (sessionID=${sessionID ?? "none"}, chatType=${event.chatType})`,
      )
      return
    }

    // [feat: feishu-group-slash-command] 2026-05-24
    // /group <群名> — 显式建群命令(主路径,0 LLM 调用)
    //
    // 群聊禁用:跟 /new 一致策略,群里建子群 UX 不清晰。
    // 私聊命中:解析成功 → 弹 confirm card → user 点 ✅ → executeGroupCreate
    //         解析失败(无参数 / 超长) → reply 提示
    //
    // 设计:绕开 LLM provider,所有 provider(default / claude-code / imbot)行为一致。
    const groupCmd = parseGroupCommand(cleaned)
    if (groupCmd.matched) {
      if (event.chatType !== "p2p") {
        await this.sendFeishuText(
          event.chatId,
          "⚠️ /group 仅支持私聊（群里建子群 UX 不清晰，请在私聊里执行）",
        )
        return
      }
      if (groupCmd.error === "no_name") {
        await this.sendFeishuText(
          event.chatId,
          "⚠️ 用法：`/group <群名>`，例：`/group 项目讨论`",
        )
        return
      }
      if (groupCmd.error === "too_long") {
        await this.sendFeishuText(
          event.chatId,
          `⚠️ 群名超长（最多 ${GROUP_NAME_MAX_LEN} 字符，飞书限制），请缩短后重试`,
        )
        return
      }
      const name = groupCmd.groupName!
      console.log(
        `[pipeline ${this.opts.accountId}] /group dispatch name="${name}" — skip LLM, send confirm card`,
      )
      const requestID = `cg_${event.messageId}_${++this.confirmCounter}`
      const spec = {
        title: `🆕 创建群【${name}】?`,
        body: `你请求创建群 **${name}** 并把你拉进群。点【✅ 确认】才会建,【❌ 拒绝】不动。`,
      }
      void this.confirmController
        .start(requestID, event.chatId, spec, async (confirmed) => {
          if (!confirmed) {
            console.log(
              `[pipeline ${this.opts.accountId}] user rejected /group create '${name}'`,
            )
            return
          }
          await this.executeGroupCreate(name, event.chatId, event.senderOpenId)
        })
        .catch((err) => {
          console.error(
            `[pipeline ${this.opts.accountId}] /group confirmController.start error:`,
            err,
          )
        })
      return
    }

    // [feat: feishu-group-slash-command] 2026-05-24
    // 自然语言建群意图回退引导 — 白名单短语命中 → 不走 LLM,reply 引导用 /group
    //
    // 设计:provider-agnostic 兜底防 imbot wall(claude-code 等跳过 system prompt 的
    // provider 看不到 GROUP_CREATION_GUIDE_PROMPT,这里直接拦)。p2p only 跟 /new 一致。
    // flag 不再影响行为(flag 关时 user 仍可以 /group,不需要"启用"操作 — slash command
    // 显式触发是 user 主动授权,不需要预先 opt-in)。
    if (event.chatType === "p2p" && isGroupCreationIntent(cleaned)) {
      console.log(
        `[pipeline ${this.opts.accountId}] natural-language group intent detected ` +
          `(text="${cleaned.slice(0, 50)}") — guide user to /group`,
      )
      await this.sendFeishuText(
        event.chatId,
        [
          "你想创建群？请使用斜杠命令：",
          "",
          "  `/group <群名>`",
          "",
          "例：",
          "  • `/group 项目讨论`",
          "  • `/group 产品需求-2026Q2`",
          "",
          "（创建后我会拉你进群，后续讨论在那里继续）",
        ].join("\n"),
      )
      return
    }

    // [feat: feishu-group-mention-policy] 2026-05-24
    // 群消息 + requireMention=true(默认)+ bot 没被 @ → 早退,不调 LLM
    //
    // 前置条件:requireMention=false 实际生效需要 user 先在飞书开放平台改订阅
    // 模式为"全量群消息";否则飞书 server 不推非 @ 消息,本检查根本不会执行。
    //
    // 设计:p2p 私聊一律响应 / 群聊但 bot 被 @ 响应 / 群聊且 requireMention=false 响应。
    // 防御性 isBotMentioned 在 botOpenId 缺失时返 false,保守拒响应。
    if (
      event.chatType !== "p2p" &&
      this.opts.account.requireMention &&
      !isBotMentioned(event.mentions, this.opts.account.botName ?? "")
    ) {
      console.log(
        `[pipeline ${this.opts.accountId}] group msg without bot @ ` +
          `(chat=${event.chatId.slice(-8)}, requireMention=true) — skip LLM`,
      )
      return
    }

    console.log(
      `[pipeline ${this.opts.accountId}] msg from chat=${event.chatId}: "${text.slice(0, 100)}"`,
    )

    // 立即给 user 消息加 reaction(表情回复),让 user 知道"消息已收到正在响应"
    // best-effort fire-and-forget,失败不阻断主流程
    void this.ackMessage(event.messageId).catch((err) =>
      console.warn(
        `[pipeline ${this.opts.accountId}] ack reaction failed:`,
        (err as Error).message,
      ),
    )

    // 仅复用 *本 sidecar lifecycle 内* 创建的 session(in-memory cache)。
    // 历史 session(sidecar 上次启动前创建的)因 opencode 内部 InstanceState 不预 load
    // 而对 GET /session/{id}/message 路由返 401,导致拉不到 reply。
    // 短期 trade-off:sidecar 重启后所有 chat 第一条消息开新 session(无跨重启 multi-turn memory),
    // 但同 sidecar lifetime 内 chat 仍 multi-turn 复用 session。
    // FUTURE:让旧 session 也能拉(可能改走 /api/session/{id}/message 或 reload state)
    let sessionID = this.chatToSession.get(event.chatId)
    if (!sessionID) {
      try {
        const res = await this.opts.opencodeClient.session.create({
          query: { directory: IMBOT_WORKSPACE },
          body: {
            title: `Feishu ${event.chatType}/${event.chatId.slice(-8)}`,
          },
        })
        const id = (res as { data?: { id?: string } }).data?.id
        if (!id) throw new Error("session.create returned no id")
        sessionID = id
        this.chatToSession.set(event.chatId, sessionID)
        this.sessionToChat.set(sessionID, event.chatId)
        // 落盘:plugin 重启后同 chat 仍能复用此 session
        this.opts.chatSessionStore.set(this.opts.accountId, event.chatId, sessionID)
        // 🚨 立即 archive 飞书 plugin 创建的 session,user GUI sidebar 不显示
        await this.archiveSession(sessionID).catch((archErr) => {
          console.warn(
            `[pipeline ${this.opts.accountId}] archive session ${sessionID} failed (会显示在 GUI):`,
            archErr,
          )
        })
        console.log(
          `[pipeline ${this.opts.accountId}] new opencode session ${sessionID} (archived,持久化) for chat=${event.chatId}`,
        )
      } catch (err) {
        console.error(`[pipeline ${this.opts.accountId}] createSession failed:`, err)
        await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
        return
      }
    }

    // FORK-BEGIN: REQ-036 引用/回复原文注入 2026-06-02
    // 架构说明:注入在 user message parts(text part),对所有 agent 均有效
    // (包括 claude-code plugin 等不读 system prompt 的 plugin agent)。
    let quotedContext: string | null = null
    if (event.parentId) {
      quotedContext = await fetchParentMessageText(event.parentId, this.larkClient).catch(
        () => null,
      )
      if (quotedContext !== null) {
        console.log(
          `[pipeline ${this.opts.accountId}] quote parent=${event.parentId}: "${quotedContext.slice(0, 60)}"`,
        )
      }
    }
    const promptText =
      quotedContext !== null
        ? `[引用原文]\n${quotedContext}\n[/引用原文]\n\n${cleaned}`
        : cleaned
    // FORK-END

    let reply: string
    try {
      // [feat: feishu-llm-strip-mention-placeholders] 2026-05-24
      // 传 cleaned(已 strip @_user_N 飞书占位符)而非 raw text,避免 LLM 误把
      // 占位符当成另一个联系人(实测 bot reply 含"我不是 @_user_1..."类幻觉)。
      reply = await this.runOpencode(sessionID, promptText, this.opts.account.agent, {
        imagePart,
        imageDownloadError,
      })
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] opencode error:`, err)
      await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
      return
    }

    // reply 后处理:ATTACH marker(总是)→ 上传文件(同步)、strip marker、失败 warning append。
    // [CREATE_GROUP:name] marker 路径已删([feat: feishu-group-slash-command] 2026-05-24),
    // 建群只走用户显式 /group slash command。
    const finalText = await this.processAttachments(reply, event.chatId)

    if (!finalText.trim()) {
      // [feat: feishu-llm-timeout-surface] 2026-06-01 兜底防御
      // runOpencode 已 throw 覆盖大多数"无输出"路径,这里只可能是 processAttachments
      // 把 [ATTACH:xxx] 处理完后剩纯空白(LLM 只返 marker 没文本)。仍发 fallback,
      // 消除"bot 死了"黑洞。
      console.warn(`[pipeline ${this.opts.accountId}] empty reply for chat=${event.chatId}`)
      await this.sendFeishuText(event.chatId, EMPTY_REPLY_FALLBACK).catch((err) => {
        console.error(`[pipeline ${this.opts.accountId}] empty-reply fallback send failed:`, err)
      })
      return
    }

    console.log(
      `[pipeline ${this.opts.accountId}] reply (len=${finalText.length}) preview: "${finalText.slice(0, 200)}"`,
    )
    try {
      await this.sendFeishuText(event.chatId, finalText)
      console.log(
        `[pipeline ${this.opts.accountId}] sent reply to chat=${event.chatId}: "${finalText.slice(0, 100)}"`,
      )
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] sendFeishuText failed:`, err)
    }
  }

  /**
   * [feat: feishu-merge-forward] 2026-05-26
   * merge_forward 独立处理路径(跟 text/image/post 的 handle 主流程并列)。
   *
   * 流程:
   *   1. 立即回 user "📋 收到合并消息,展开中..."
   *   2. fetch 子消息列表(SDK + 30s timeout / R1)
   *   3. 0 子消息 / 拉取失败 → 友好回复(R3)
   *   4. vision 预检(R4)— 不支持图 → textOnly 模式(maxImages=0)
   *   5. flatten(R2 时间序 + D3 截断 + D5 sender 前缀 + D6 占位)
   *   6. 嵌套递归(D4):depth=0 调本方法子流程,1 层后占位
   *   7. 下载图(继承 image-downloader S1-S5)
   *   8. session create + runOpencode(text + N file part)+ reply
   */
  private async handleMergeForward(event: ImMessageEvent): Promise<void> {
    // 1. 立即回 user
    await this.sendFeishuText(event.chatId, "📋 收到合并消息,展开中...").catch((err) => {
      console.warn(`[pipeline ${this.opts.accountId}] 发送展开中提示失败:`, err)
    })

    // 2. fetch + R3 错误兜底
    let items: SubMessage[]
    try {
      items = await fetchMergeForwardItems(event.messageId, this.larkClient)
    } catch (err) {
      const msg = (err as Error).message
      console.warn(`[pipeline ${this.opts.accountId}] merge_forward fetch failed:`, msg)
      await this.sendFeishuText(
        event.chatId,
        `❌ 没能展开这条合并消息(原因:${msg})。把内容直接发我也行。`,
      ).catch(() => {})
      return
    }

    if (items.length === 0) {
      await this.sendFeishuText(
        event.chatId,
        "😅 这条合并消息好像是空的,换条试试?",
      ).catch(() => {})
      return
    }

    // 3. flatten 顶层(depth=0)
    // FORK: 合并转发里的图片飞书 API 不支持读取(错误码 234043 / HTTP 400,见
    // OPENCODE-PLAN/需求池/飞书合并转发子图下载-400-bug.md)→ maxImages=0:不建下载列表、
    // 不假装"已展开识别";含图时改在回复头部给用户诚实提示(步骤 11)。
    // [feat: feishu-merge-forward-image-400] 2026-05-27
    const flatten = flattenMergeForward(items, {
      withSender: event.chatType !== "p2p",
      maxSubMessages: MAX_SUB_MESSAGES,
      maxImages: 0,
      depth: 0,
    })

    // 5. 嵌套递归 1 层(D4) — depth=0 flatten 后,把嵌套占位替换为子内容
    // 实现:遍历 items 找 msg_type=merge_forward 的,深度递归 fetch + flatten depth=1
    // 然后把"[嵌套合并消息(展开中)]"占位文本替换成 "  ↳ {嵌套 flatten text}"
    const expandedText = await this.expandNestedMergeForward(
      flatten.text,
      items,
      0, // 嵌套层的图同样不可下载(同 234043),不下载
      event.chatType !== "p2p",
    )

    // 6. 合并转发的图片【不下载】— 飞书 API 不支持读取合并转发内的资源(234043),下载必 400。
    // imageParts 恒空(maxImages=0 → flatten.images 也为空);含图时在回复头部给用户诚实提示(步骤 11)。
    // [feat: feishu-merge-forward-image-400] 2026-05-27
    const imageParts: Array<{ mime: string; filename: string; absolutePath: string }> = []

    // 7. 组装最终 text(flatten + nested expanded + vision-incapable warning)
    let finalText = expandedText.flat()
    finalText = `(以下是用户合并转发给你的对话内容,共 ${items.length} 条子消息${expandedText.nestedCount > 0 ? `,含 ${expandedText.nestedCount} 个嵌套合并消息` : ""})\n\n${finalText}\n\n请基于这些内容回答用户的问题或给出总结/建议。`

    // FORK: 合并转发含图 → 告诉 LLM 图读不了(只基于文字回答),且无需在回复里重复说明
    //(用户侧的诚实提示由步骤 11 在回复头部统一加,避免重复)。[feat: feishu-merge-forward-image-400]
    if (flatten.imageCount > 0) {
      finalText +=
        "\n\n(注:这条合并转发里有图片,但飞书接口不支持读取合并转发内的图片,你看不到图片内容,只基于文字回答即可,无需在回复中说明这一点。)"
    }

    // 8. 立即给 user 消息加 reaction
    void this.ackMessage(event.messageId).catch((err) =>
      console.warn(
        `[pipeline ${this.opts.accountId}] ack reaction failed:`,
        (err as Error).message,
      ),
    )

    // 9. session create / 复用(跟 handle 主流程同款)
    let sessionID = this.chatToSession.get(event.chatId)
    if (!sessionID) {
      try {
        const res = await this.opts.opencodeClient.session.create({
          query: { directory: IMBOT_WORKSPACE },
          body: { title: `Feishu ${event.chatType}/${event.chatId.slice(-8)}` },
        })
        const id = (res as { data?: { id?: string } }).data?.id
        if (!id) throw new Error("session.create returned no id")
        sessionID = id
        this.chatToSession.set(event.chatId, sessionID)
        this.sessionToChat.set(sessionID, event.chatId)
        this.opts.chatSessionStore.set(this.opts.accountId, event.chatId, sessionID)
        await this.archiveSession(sessionID).catch((archErr) => {
          console.warn(
            `[pipeline ${this.opts.accountId}] archive session ${sessionID} failed:`,
            archErr,
          )
        })
        console.log(
          `[pipeline ${this.opts.accountId}] new opencode session ${sessionID} (merge_forward) for chat=${event.chatId}`,
        )
      } catch (err) {
        console.error(`[pipeline ${this.opts.accountId}] createSession failed:`, err)
        await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
        return
      }
    }

    // 10. runOpencode(text + N file part)
    let reply: string
    try {
      reply = await this.runOpencode(sessionID, finalText, this.opts.account.agent, {
        imagePart: null,
        imageParts,
        imageDownloadError: null,
      })
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] opencode error (merge_forward):`, err)
      await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
      return
    }

    // 11. 后处理 + reply
    let finalReply = await this.processAttachments(reply, event.chatId)
    if (!finalReply.trim()) {
      // [feat: feishu-llm-timeout-surface] 2026-06-01 同 handle() 兜底
      // [review-followup #3] 2026-06-01 — 把 image-count warning 注入提前到 empty
      // 检查之前,空 reply + 含图场景仍能告诉用户"合并转发里的图我读不了",不只剩
      // 通用 EMPTY_REPLY_FALLBACK。把 finalReply 改成 EMPTY_REPLY_FALLBACK,继续
      // 走下面的 image-count 注入 + sendFeishuText,共用一条路径。
      console.warn(`[pipeline ${this.opts.accountId}] empty reply for merge_forward`)
      finalReply = EMPTY_REPLY_FALLBACK
    }
    // FORK: 合并转发含图 → 回复头部加一行诚实提示(飞书 API 不支持读取合并转发内图片)。
    // [feat: feishu-merge-forward-image-400] 2026-05-27
    if (flatten.imageCount > 0) {
      finalReply =
        `📷 合并转发里的 ${flatten.imageCount} 张图片我读不了(飞书接口限制),需要识别请直接把图转发给我。\n\n` +
        finalReply
    }
    try {
      await this.sendFeishuText(event.chatId, finalReply)
      console.log(
        `[pipeline ${this.opts.accountId}] merge_forward reply sent (len=${finalReply.length})`,
      )
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] sendFeishuText failed:`, err)
    }
  }

  /**
   * [feat: feishu-merge-forward] 2026-05-26
   * 嵌套 merge_forward 1 层递归展开(D4)。
   *
   * 找 items 里 msg_type=merge_forward 的子消息,fetch 其内容并 depth=1 flatten,
   * 把顶层 flatten text 里 "[嵌套合并消息(展开中)]" 占位替换成 "  ↳ <嵌套内容>"。
   *
   * @param baseFlattenText  顶层 flattenMergeForward 输出的 text
   * @param items            顶层 items(含 msg_type=merge_forward 项)
   * @param remainingImageQuota  剩余图配额(顶层用了 N 张,嵌套总共最多再用 maxImages-N 张)
   * @param withSender       群聊 true / p2p false
   * @returns { flat: 替换后的文本, nestedCount: 实际展开的嵌套数 }
   */
  private async expandNestedMergeForward(
    baseFlattenText: string,
    items: SubMessage[],
    remainingImageQuota: number,
    withSender: boolean,
  ): Promise<{ flat: () => string; nestedCount: number }> {
    const nestedItems = items.filter((i) => i.msg_type === "merge_forward")
    if (nestedItems.length === 0) {
      return { flat: () => baseFlattenText, nestedCount: 0 }
    }

    let resultText = baseFlattenText
    let nestedCount = 0
    let remaining = remainingImageQuota

    for (const nested of nestedItems) {
      if (!nested.message_id) continue
      try {
        const subItems = await fetchMergeForwardItems(nested.message_id, this.larkClient)
        // depth=1 → renderSubMessage 会把 depth>=MAX_NEST_DEPTH 的嵌套占位 "深度超限"
        const subFlatten = flattenMergeForward(subItems, {
          withSender,
          maxSubMessages: MAX_SUB_MESSAGES,
          maxImages: remaining,
          depth: MAX_NEST_DEPTH, // depth=1 — 再嵌套的占位 "深度超限"
        })
        remaining -= subFlatten.images.length

        // 嵌套展开内容每行缩进 "  ↳ "
        const indented = subFlatten.text
          .split("\n")
          .map((line) => `  ↳ ${line}`)
          .join("\n")
        // 替换占位(只替换第一个 — 因为 flatten 输出占位顺序跟 items.filter 顺序一致,
        // 我们这里也是按 items 顺序遍历)
        resultText = resultText.replace("[嵌套合并消息(展开中)]", indented)
        nestedCount += 1
      } catch (err) {
        console.warn(
          `[pipeline ${this.opts.accountId}] 嵌套 merge_forward ${nested.message_id} 展开失败,占位:`,
          (err as Error).message,
        )
        // 失败时占位换成 "(展开失败)" 让 LLM 知道
        resultText = resultText.replace(
          "[嵌套合并消息(展开中)]",
          `[嵌套合并消息(展开失败:${(err as Error).message.slice(0, 50)})]`,
        )
      }
    }

    return { flat: () => resultText, nestedCount }
  }

  // FORK-BEGIN: REQ-035 文件消息独立处理路径 2026-06-02
  /**
   * 处理飞书 file 类型消息:下载 → 抽取文本 → 喂 LLM → 发回复。
   *
   * 架构说明:文件内容以 text part 注入 user message,对所有 opencode agent
   * (imbot/build/claude-code plugin 等)均有效,不依赖 system prompt。
   */
  private async handleFileMessage(event: ImMessageEvent): Promise<void> {
    // 解析 file_key + file_name
    let fileKey: string
    let fileName: string
    try {
      const parsed = JSON.parse(event.content) as { file_key?: string; file_name?: string }
      fileKey = parsed.file_key ?? ""
      fileName = parsed.file_name ?? "未知文件"
    } catch {
      console.warn(`[pipeline ${this.opts.accountId}] file msg: invalid content JSON`)
      return
    }
    if (!fileKey) {
      console.warn(`[pipeline ${this.opts.accountId}] file msg: missing file_key`)
      return
    }

    // 群消息 mention policy(与 handle() 主路径一致)
    if (
      event.chatType !== "p2p" &&
      this.opts.account.requireMention &&
      !isBotMentioned(event.mentions, this.opts.account.botName ?? "")
    ) {
      return
    }

    // FORK-BEGIN: REQ-035 文件格式判断 + 下载保存 + 注入格式升级 2026-06-03
    const format = detectFileFormat(fileName)

    // 不支持 / 旧版 Office → 直接友好回复,不下载
    if (format === "unsupported" || format === "legacy_office") {
      const msg =
        format === "legacy_office"
          ? `⚠️ 旧版 Office 格式《${fileName}》暂不支持直接解析。\n请另存为 .xlsx / .docx / .pptx 后重发。`
          : `⚠️ 暂不支持读取《${fileName}》格式。\n目前支持:图片 / txt / md / csv / json / 代码文件 / docx / xlsx / pptx / pdf。`
      await this.sendFeishuText(event.chatId, msg).catch(() => {})
      return
    }

    // 图片 → 多模态 vision 路径(vision 预检 → 下载 → file part 注入)
    if (format === "image") {
      await this.handleImageFile(event, fileName, fileKey)
      return
    }

    // ack + 进度反馈(text/docx/xlsx/pptx/pdf 都下载)
    void this.ackMessage(event.messageId).catch((err) =>
      console.warn(`[pipeline ${this.opts.accountId}] file ack failed:`, (err as Error).message),
    )
    await this.sendFeishuText(event.chatId, `📄 收到文件《${fileName}》,读取中...`).catch(
      () => {},
    )

    // 下载 + 保存到磁盘
    let absolutePath: string
    let fileBuf: Uint8Array
    try {
      const auth = await getClientAuthContext(this.larkClient)
      const saved = await this.downloadAndSaveFile(
        fileKey,
        event.messageId,
        event.chatId,
        fileName,
        auth.token,
        auth.domain,
      )
      absolutePath = saved.absolutePath
      fileBuf = saved.buf
      console.log(
        `[pipeline ${this.opts.accountId}] downloaded+saved file ${fileName} ${fileBuf.length}B → ${absolutePath}`,
      )
    } catch (err) {
      const msg = (err as Error).message
      console.warn(`[pipeline ${this.opts.accountId}] file download/save failed (${fileName}):`, msg)
      await this.sendFeishuText(
        event.chatId,
        `😅 没能下载《${fileName}》(原因:${msg})。请重新发送试试?`,
      ).catch(() => {})
      return
    }

    const sizeStr = formatFileSize(fileBuf.length)
    const formatDisplay = getFormatDisplay(fileName)

    // FORK: PDF 支持 2026-06-03 — 统一走 LLM,pdf 用异步抽取,text/docx 用同步抽取
    const extracted =
      format === "pdf"
        ? await extractPdfTextAsync(fileBuf, fileName)
        : extractTextFromBuffer(fileBuf, format, fileName)

    const fileContext = [
      `[文件《${fileName}》已保存]`,
      `路径: ${absolutePath}`,
      `大小: ${sizeStr} | 格式: ${formatDisplay}`,
      ``,
      `文件内容(共 ${extracted.text.length} 字${extracted.truncated ? ",已截断" : ""}):`,
      extracted.text,
    ].join("\n")
    // FORK-END

    // 获取 / 创建 session(跟 handle() 主路径同款)
    let sessionID = this.chatToSession.get(event.chatId)
    if (!sessionID) {
      try {
        const res = await this.opts.opencodeClient.session.create({
          query: { directory: IMBOT_WORKSPACE },
          body: { title: `Feishu ${event.chatType}/${event.chatId.slice(-8)}` },
        })
        const id = (res as { data?: { id?: string } }).data?.id
        if (!id) throw new Error("session.create returned no id")
        sessionID = id
        this.chatToSession.set(event.chatId, sessionID)
        this.sessionToChat.set(sessionID, event.chatId)
        this.opts.chatSessionStore.set(this.opts.accountId, event.chatId, sessionID)
        await this.archiveSession(sessionID).catch((archErr) => {
          console.warn(
            `[pipeline ${this.opts.accountId}] archive session ${sessionID} (file) failed:`,
            archErr,
          )
        })
        console.log(
          `[pipeline ${this.opts.accountId}] new session ${sessionID} (file:${fileName}) for chat=${event.chatId}`,
        )
      } catch (err) {
        console.error(`[pipeline ${this.opts.accountId}] createSession failed (file):`, err)
        await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
        return
      }
    }

    // runOpencode
    let reply: string
    try {
      reply = await this.runOpencode(sessionID, fileContext, this.opts.account.agent)
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] opencode error (file):`, err)
      await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
      return
    }

    // 后处理 + 发送
    const finalReply = await this.processAttachments(reply, event.chatId)
    if (!finalReply.trim()) {
      await this.sendFeishuText(event.chatId, EMPTY_REPLY_FALLBACK).catch(() => {})
      return
    }
    try {
      await this.sendFeishuText(event.chatId, finalReply)
      console.log(
        `[pipeline ${this.opts.accountId}] file reply sent (${fileName}, len=${finalReply.length})`,
      )
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] sendFeishuText (file) failed:`, err)
    }
  }

  /**
   * 飞书文件下载 + 保存到磁盘。
   * 同 downloadFeishuImage 的 Bun-native fetch 模式,避开 axios+Buffer 兼容问题。
   * FORK: REQ-035 downloadAndSaveFile 2026-06-03(原 downloadFileBuffer 加磁盘写入)
   *
   * @returns { absolutePath, buf } — absolutePath 供注入 prompt,buf 供文本抽取
   */
  private async downloadAndSaveFile(
    fileKey: string,
    messageId: string,
    chatId: string,
    fileName: string,
    tenantAccessToken: string,
    domain = "https://open.feishu.cn",
  ): Promise<{ absolutePath: string; buf: Uint8Array }> {
    const MAX_FILE_BYTES = 30 * 1024 * 1024
    const url =
      `${domain}/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=file`
    const ctrl = new AbortController()
    const handle = setTimeout(() => ctrl.abort(), 30_000)
    let res: Response
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${tenantAccessToken}` },
        signal: ctrl.signal,
      })
    } catch (err) {
      clearTimeout(handle)
      throw new Error(
        (err as Error).name === "AbortError"
          ? `飞书文件下载超时 for file_key=${fileKey}`
          : `飞书文件下载网络错误 for file_key=${fileKey}: ${(err as Error).message}`,
      )
    }
    clearTimeout(handle)
    if (!res.ok) {
      throw new Error(
        `飞书文件下载失败 ${res.status} ${res.statusText} for file_key=${fileKey}`,
      )
    }
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length > MAX_FILE_BYTES) {
      throw new Error(
        `飞书文件过大 ${(buf.length / 1024 / 1024).toFixed(1)}MB > 30MB for file_key=${fileKey}`,
      )
    }
    if (buf.length === 0) {
      throw new Error(`飞书文件空 (0 bytes) for file_key=${fileKey}`)
    }

    // 保存到磁盘: {feishuFilesRoot}/{safeChatId}/{YYYYMMDD}-{safeFileName}
    const filesRoot = this.opts.feishuFilesRoot ?? join(IMBOT_WORKSPACE, "feishu-files")
    const safeChatId = chatId.replace(/[/\\:*?"<>|]/g, "_").slice(0, 64)
    const safeFileName = fileName.replace(/[/\\:*?"<>|]/g, "_")
    const d = new Date()
    const dateStr =
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
    const dir = join(filesRoot, safeChatId)
    mkdirSync(dir, { recursive: true })
    const absolutePath = join(dir, `${dateStr}-${safeFileName}`)
    writeFileSync(absolutePath, buf)

    return { absolutePath, buf }
  }

  /**
   * FORK: 图片文件消息多模态路径 2026-06-03
   * 从飞书 file 类型消息里收到图片扩展名 → vision 预检 → 下载保存 → file part 注入 LLM。
   * 与 handle() 里 messageType="image" 的处理逻辑对称,但走的是文件下载 endpoint。
   */
  private async handleImageFile(
    event: ImMessageEvent,
    fileName: string,
    fileKey: string,
  ): Promise<void> {
    // vision 预检(同 handle() 路径)
    const visionOk = await this.checkModelVisionSupport().catch(() => true)
    if (!visionOk) {
      const modelHint = this.opts.account.model
        ? `${this.opts.account.model.providerID}/${this.opts.account.model.modelID}`
        : "当前默认 model"
      await this.sendFeishuText(
        event.chatId,
        `⚠️ ${modelHint} 不支持图片识别。请到 DeskFox 设置 → 飞书桥接 → 选当前账号 → 编辑 → Model，换成支持视觉的模型(如 Claude/GPT-4o/Gemini 等)。`,
      ).catch(() => {})
      return
    }

    void this.ackMessage(event.messageId).catch((err) =>
      console.warn(`[pipeline ${this.opts.accountId}] image file ack failed:`, (err as Error).message),
    )
    await this.sendFeishuText(event.chatId, `🖼️ 收到图片文件《${fileName}》,识别中...`).catch(() => {})

    // 下载 + 保存
    let imagePart: { mime: string; filename: string; absolutePath: string }
    try {
      const auth = await getClientAuthContext(this.larkClient)
      const saved = await this.downloadAndSaveFile(
        fileKey,
        event.messageId,
        event.chatId,
        fileName,
        auth.token,
        auth.domain,
      )
      imagePart = { mime: getImageMime(fileName), filename: fileName, absolutePath: saved.absolutePath }
      console.log(
        `[pipeline ${this.opts.accountId}] downloaded image file ${fileName} ${saved.buf.length}B → ${saved.absolutePath}`,
      )
    } catch (err) {
      const msg = (err as Error).message
      console.warn(`[pipeline ${this.opts.accountId}] image file download failed (${fileName}):`, msg)
      await this.sendFeishuText(
        event.chatId,
        `😅 没能下载图片《${fileName}》(原因:${msg})。请重新发送试试?`,
      ).catch(() => {})
      return
    }

    // 获取 / 创建 session(同 handleFileMessage)
    let sessionID = this.chatToSession.get(event.chatId)
    if (!sessionID) {
      try {
        const res = await this.opts.opencodeClient.session.create({
          query: { directory: IMBOT_WORKSPACE },
          body: { title: `Feishu ${event.chatType}/${event.chatId.slice(-8)}` },
        })
        const id = (res as { data?: { id?: string } }).data?.id
        if (!id) throw new Error("session.create returned no id")
        sessionID = id
        this.chatToSession.set(event.chatId, sessionID)
        this.sessionToChat.set(sessionID, event.chatId)
        this.opts.chatSessionStore.set(this.opts.accountId, event.chatId, sessionID)
        await this.archiveSession(sessionID).catch((archErr) => {
          console.warn(`[pipeline ${this.opts.accountId}] archive session (image file) failed:`, archErr)
        })
        console.log(`[pipeline ${this.opts.accountId}] new session ${sessionID} (image file:${fileName})`)
      } catch (err) {
        console.error(`[pipeline ${this.opts.accountId}] createSession failed (image file):`, err)
        await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
        return
      }
    }

    let reply: string
    try {
      // 空 text + imagePart → LLM 直接看图描述/回答
      reply = await this.runOpencode(sessionID, "", this.opts.account.agent, {
        imagePart,
        imageDownloadError: null,
      })
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] opencode error (image file):`, err)
      await this.sendFeishuText(event.chatId, friendlyErrorReply(err as Error))
      return
    }

    const finalReply = await this.processAttachments(reply, event.chatId)
    if (!finalReply.trim()) {
      await this.sendFeishuText(event.chatId, EMPTY_REPLY_FALLBACK).catch(() => {})
      return
    }
    try {
      await this.sendFeishuText(event.chatId, finalReply)
      console.log(`[pipeline ${this.opts.accountId}] image file reply sent (${fileName}, len=${finalReply.length})`)
    } catch (err) {
      console.error(`[pipeline ${this.opts.accountId}] sendFeishuText (image file) failed:`, err)
    }
  }
  // FORK-END

  /**
   * [feat: feishu-bridge-light] 解析 reply 里的 [ATTACH:path] marker、上传文件、strip marker。
   *
   * 安全约束:路径必须在 ~/.opencode/imbot-workspace/ 子树内(classifyAttachment 判)。
   * 单个 ATTACH 失败不影响其它;失败原因追加到最终文本 warnings 段尾,user 可见。
   *
   * 返回最终要发到飞书的文本(可能为空 — 全是附件无文字时)。
   *
   * 非 private 以便单测直接驱动(等同 testHandle 模式)。
   */
  async processAttachments(reply: string, chatId: string): Promise<string> {
    const { paths, cleanText } = parseAttachMarkers(reply)
    if (paths.length === 0) return reply

    console.log(
      `[pipeline ${this.opts.accountId}] reply has ${paths.length} ATTACH marker(s): ${paths.join(", ")}`,
    )
    const warnings: string[] = []
    for (const p of paths) {
      const cls = classifyAttachment(p, this.opts.attachWorkspaceRoot)
      if (cls.kind === "reject") {
        warnings.push(`⚠️ 拒绝发送 \`${p}\`:${cls.reason}`)
        console.warn(
          `[pipeline ${this.opts.accountId}] ATTACH reject: ${p} (${cls.reason})`,
        )
        continue
      }
      try {
        if (cls.kind === "image") {
          const key = await uploadImage(this.larkClient, p)
          await sendImageMessage(this.larkClient, chatId, key)
          console.log(`[pipeline ${this.opts.accountId}] sent image ${p} → ${key}`)
        } else {
          const key = await uploadFile(this.larkClient, p, cls.fileType)
          await sendFileMessage(this.larkClient, chatId, key)
          console.log(`[pipeline ${this.opts.accountId}] sent file ${p} → ${key}`)
        }
      } catch (e) {
        const msg = (e as Error).message
        warnings.push(`⚠️ 发送 \`${p}\` 失败:${msg}`)
        console.warn(`[pipeline ${this.opts.accountId}] ATTACH upload failed ${p}: ${msg}`)
      }
    }
    return [cleanText, ...warnings].filter((s) => s.trim()).join("\n\n")
  }

  /**
   * [feat: feishu-bridge-light] user 确认建群后实际执行 — chat.create + chat.link + 发结果消息。
   * 任一步失败都把原因发给 user(不抛,避免 confirmController callback 异常吞掉 user 反馈)。
   */
  private async executeGroupCreate(
    name: string,
    originalChatId: string,
    senderOpenId: string | undefined,
  ): Promise<void> {
    try {
      const { chatId, name: actualName } = await createGroup(
        this.larkClient,
        name,
        senderOpenId ? [senderOpenId] : [],
      )
      console.log(
        `[pipeline ${this.opts.accountId}] created group '${actualName}' chatId=${chatId} (拉 user=${senderOpenId ?? "none"})`,
      )
      const shareLink = await getShareLink(this.larkClient, chatId)
      const msg = shareLink
        ? `✅ 已创建群【${actualName}】\n加入链接(一周有效):${shareLink}`
        : `✅ 已创建群【${actualName}】\nchat_id: \`${chatId}\`(分享链接获取失败,可能是团队群限制或权限不足)`
      await this.sendFeishuText(originalChatId, msg)
    } catch (err) {
      const errMsg = (err as Error).message
      console.error(
        `[pipeline ${this.opts.accountId}] executeGroupCreate '${name}' failed:`,
        errMsg,
      )
      try {
        await this.sendFeishuText(
          originalChatId,
          `❌ 创建群【${name}】失败:${errMsg}`,
        )
      } catch (sendErr) {
        console.error(
          `[pipeline ${this.opts.accountId}] notify create-group failure also failed:`,
          sendErr,
        )
      }
    }
  }

  /**
   * 启动 prompt + 等 dispatcher 拿 reply。
   *
   * register waiter 必须在 promptAsync **之前**(防错过早期 events)。
   *
   * !! 已知 bug:dispatcher 累积所有 text part(包括 user prompt 的 part)→ reply echo user 输入。
   *    修需要按 message role 区分(part 没 role 字段,得通过 message.updated event 反查)。
   *    留 followup,先保证有 reply(echo)优于 empty reply。
   */
  /**
   * [feat: feishu-image-recognition] 2026-05-26
   * 预检 account 配的 model 是否支持 image input(vision)。
   * 用 opencodeClient.config.providers() 查 model.capabilities.input.image。
   *
   * 缓存 10 min,key = providerID/modelID(或 __default__)。
   * 查询失败默认返 true(放行 — 假设支持,后续 LLM 收 ERROR text 会自己回 user 不支持)。
   */
  private async checkModelVisionSupport(): Promise<boolean> {
    const model = this.opts.account.model
    const cacheKey = model ? `${model.providerID}/${model.modelID}` : "__default__"
    const cached = this.visionCapCache.get(cacheKey)
    if (isVisionCacheFresh(cached)) {
      return cached!.supportsImage
    }

    if (!model) {
      // 未指定 model — 走 global default,不阻塞(放行让用户验)
      this.visionCapCache.set(cacheKey, { supportsImage: true, checkedAt: Date.now() })
      return true
    }

    try {
      const res = await this.opts.opencodeClient.config.providers({
        query: { directory: IMBOT_WORKSPACE },
      })
      const supportsImage = extractVisionSupport(
        (res as { data?: unknown }).data,
        model.providerID,
        model.modelID,
      )
      this.visionCapCache.set(cacheKey, { supportsImage, checkedAt: Date.now() })
      console.log(
        `[pipeline ${this.opts.accountId}] vision check ${cacheKey} → image=${supportsImage}`,
      )
      return supportsImage
    } catch (err) {
      console.warn(
        `[pipeline ${this.opts.accountId}] vision check failed for ${cacheKey}, 放行:`,
        err,
      )
      // 查询失败放行(假设支持),避免 false negative 卡住用户
      return true
    }
  }

  private async runOpencode(
    sessionID: string,
    text: string,
    agent: string,
    // [feat: feishu-image-recognition] 2026-05-26 — 多模态 image part
    // [feat: feishu-merge-forward] 2026-05-26 — 扩展 imageParts(N 个,merge_forward 多图)
    imageOpts?: {
      /** 单图场景(image / post 消息),null 或单个 — 跟下方 imageParts 二选一,
       *  保持向后兼容 image-recognition path */
      imagePart: { mime: string; filename: string; absolutePath: string } | null
      /** 多图场景(merge_forward),N 个 file part 并存 */
      imageParts?: Array<{ mime: string; filename: string; absolutePath: string }>
      imageDownloadError: string | null
    },
  ): Promise<string> {
    // 默认 30 分钟超时(2026-05-10 由 5min 提)。
    // 实测出现过 7m18s 才完成的回复(用户问"DeskFox 服务启动后..."触发 75 次工具调用)
    // 5min 超时强制走 dispatcher partial 路径 → runOpencode 又忽略 partial 改读
    // session.messages,此时 LLM 还在跑、message 仍空,plugin 返空字符串 → 飞书没回复。
    // 30min 覆盖典型 agent 长任务上限;真要跑超 30min 的复杂任务,需走 Layer 2 重构
    // (订阅 message.updated 事件 + time.completed 字段判完成,告别启发式超时)。
    const timeoutMs = this.opts.promptTimeoutMs ?? 30 * 60 * 1000

    // [feat: feishu-llm-timeout-surface] 2026-06-01
    // dispatcher.register 返 DispatchResult (reply + source),timeout 无 partial
    // 时直接 reject,本函数依赖 catch / throw 链路把"无输出"信号送到 handle()
    // 的 friendlyErrorReply,确保用户一定能收到一条 reply(消除"bot 死了"黑洞)。
    const dispatchPromise = this.opts.dispatcher.register(sessionID, timeoutMs)

    const accountModel = this.opts.account.model
    void this.opts.opencodeClient.session
      .promptAsync({
        path: { id: sessionID },
        query: { directory: IMBOT_WORKSPACE },
        body: {
          agent,
          system: this.getSystemPrompt(),
          ...(accountModel
            ? { model: { providerID: accountModel.providerID, modelID: accountModel.modelID } }
            : {}),
          // [feat: feishu-image-recognition] 2026-05-26 — text + file part 混合
          // file part url 用 file:// 协议,opencode-cli prompt.ts:1230 自动 readFile +
          // base64 inline 给 LLM provider(0 JSON 体膨胀,0 临时 server,workspace 持久化)
          parts: [
            ...(text ? [{ type: "text" as const, text }] : []),
            ...(imageOpts?.imagePart
              ? [
                  {
                    type: "file" as const,
                    mime: imageOpts.imagePart.mime,
                    filename: imageOpts.imagePart.filename,
                    url: `file://${imageOpts.imagePart.absolutePath}`,
                  },
                ]
              : []),
            // [feat: feishu-merge-forward] 2026-05-26 — N 个 file part(多图)
            ...(imageOpts?.imageParts ?? []).map((img) => ({
              type: "file" as const,
              mime: img.mime,
              filename: img.filename,
              url: `file://${img.absolutePath}`,
            })),
            ...(imageOpts?.imageDownloadError
              ? [
                  {
                    type: "text" as const,
                    text: `(系统提示:用户发了一张图片,但下载失败:${imageOpts.imageDownloadError}。请回复说图片暂时看不到,问 user 描述一下图片内容)`,
                  },
                ]
              : []),
          ],
        },
      })
      .catch((err) => {
        console.error(`[pipeline ${this.opts.accountId}] promptAsync error:`, err)
      })

    // 等 dispatcher signal(session.idle / timeout-partial 都 resolve,timeout-empty /
    // session.error / superseded / abortAll 都 reject)。reject 一路冒到 handle() 的
    // catch → friendlyErrorReply 给 user surface,不再静默丢弃。
    const dispatchResult = await dispatchPromise

    // [feat: feishu-llm-timeout-surface review-followup] 2026-06-01
    // dispatcher 已经累积的 LLM 文本(collectText 已 trim,空字符串就是 "")。
    // 任何下游异常分支(session.messages 失败 / 空 / 无 useful / LLM error)优先用它兜底,
    // 总比让用户看到错误文案强。collectText 已 trim,这里不再 .trim()。
    const fallbackReply: string | undefined = dispatchResult.reply || undefined

    // [review-followup #5] timeout-partial happy path 短路:dispatcher 累积的就是
    // LLM 在超时窗口内流出过的全部 text part,session.messages 是同源持久化,多一次
    // RPC 无收益。session.idle 不能短路 — 那条路径需要从 session.messages 拿
    // assistantEntry.info.error 判断 LLM 是否报错。
    if (dispatchResult.source === "timeout-partial" && fallbackReply) {
      console.warn(
        `[pipeline ${this.opts.accountId}] timeout-partial 短路 — dispatcher partial 即 LLM 全量输出,跳过 session.messages RPC`,
      )
      return fallbackReply
    }

    // setImmediate 跳出当前 event hook 的 microtask scope,确保 server 端 message/part db 写完 + auth context 正常
    await new Promise<void>((resolve) => setImmediate(resolve))

    // 直接拉 messages 取 last assistant text(role 准确,不会 echo user prompt)
    const msgsRes = await this.opts.opencodeClient.session.messages({
      path: { id: sessionID },
      query: { directory: IMBOT_WORKSPACE },
    })
    const wrap = msgsRes as {
      data?: Array<{
        info: {
          id?: string
          role?: string
          parentID?: string
          error?: { message?: string; data?: { message?: string } }
        }
        parts: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean }>
      }>
      error?: unknown
      response?: { status?: number }
    }
    // [feat: feishu-llm-timeout-surface] 2026-06-01
    // 所有原"返空字符串"的兜底分支改 throw,让上层 handle() catch 走 friendlyErrorReply,
    // 用户至少能收到一条说明文本,而不是静默无回复。
    //
    // [review-followup #1] 4 个分支兜底条件从 timeout-partial 专属升级到"任何源有 fallbackReply",
    // session.idle + session.messages 失败 / 空 / no-useful / LLM error 现在也能用 dispatcher
    // 累积的 LLM 文本兜底,不再静默丢弃 session.idle 路径下的 partial。
    if (!wrap.data) {
      if (fallbackReply) {
        console.warn(
          `[pipeline ${this.opts.accountId}] messages fetch failed status=${wrap.response?.status},dispatcher.reply (source=${dispatchResult.source}) 兜底`,
        )
        return fallbackReply
      }
      throw new Error(
        `opencode session.messages 读取失败(status=${wrap.response?.status}),LLM 回复无法获取`,
      )
    }
    const data = wrap.data
    if (data.length === 0) {
      if (fallbackReply) {
        console.warn(
          `[pipeline ${this.opts.accountId}] session.messages 为空,dispatcher.reply (source=${dispatchResult.source}) 兜底`,
        )
        return fallbackReply
      }
      throw new Error("opencode session 为空(LLM 未产出任何消息)")
    }

    // 本轮 user msg id — 用来限定只取本轮 assistant(防 reject 时回退取前一轮答案)
    let userMsgId: string | undefined = undefined
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i]!.info.role === "user") {
        userMsgId = data[i]!.info.id
        break
      }
    }

    const assistantEntry = findLastUsefulAssistant(data, userMsgId)
    if (!assistantEntry) {
      console.warn(
        `[pipeline ${this.opts.accountId}] 本轮无 useful assistant(user msg=${userMsgId ?? "?"})— 可能 reject + LLM 无后续输出`,
      )
      if (fallbackReply) return fallbackReply
      throw new Error(
        "本轮 LLM 无 useful 输出(可能权限被拒 / provider 链路异常 / 30 分钟超时降级)",
      )
    }

    // 检查 LLM 错误(opencode 把 LLM API error 存进 assistant message.error)
    // [review-followup #2] LLM mid-stream 报错时,如果 dispatcher 已累积部分文本,
    // 优先返 partial — 用户能看到 LLM error 之前生成的半截答案,比纯 error 文案强。
    const err = assistantEntry.info.error
    if (err) {
      const errMsg =
        (err as { data?: { message?: string } }).data?.message ?? err.message ?? "opencode LLM error"
      if (fallbackReply) {
        console.warn(
          `[pipeline ${this.opts.accountId}] LLM 报错(${errMsg}),但 dispatcher 有 partial,返 partial 兜底`,
        )
        return fallbackReply
      }
      throw new Error(errMsg)
    }

    // 拼 text parts(skip step-start / step-finish / reasoning / tool 等;只取 type=text)
    const texts: string[] = []
    for (const p of assistantEntry.parts) {
      if (p.type === "text" && typeof p.text === "string" && !p.synthetic && !p.ignored) {
        texts.push(p.text)
      }
    }
    // [review-followup #4] LLM 只用 tool / reasoning 无 text part 时 texts 为空,
    // 改返 fallbackReply(如果有);仍空就走最末层 EMPTY_REPLY_FALLBACK 兜底链路。
    const finalText = texts.join("").trim()
    if (!finalText && fallbackReply) return fallbackReply
    return finalText
  }

  /** 测试 / debug 入口:外部调用直接驱动 handle(传 ImMessageEvent 模拟飞书消息) */
  async testHandle(event: ImMessageEvent): Promise<void> {
    return this.handle(event)
  }

  /** 测试 / debug:直接调 SDK session.messages 并打 raw response 详情(不走 pipeline) */
  async debugFetchMessages(sessionID: string): Promise<unknown> {
    const r = await this.opts.opencodeClient.session.messages({
      path: { id: sessionID },
      query: { directory: IMBOT_WORKSPACE },
    })
    const wrap = r as {
      data?: unknown
      error?: unknown
      response?: { status?: number; statusText?: string; url?: string }
      request?: { url?: string; method?: string; headers?: { get?: (k: string) => string | null } }
    }
    const auth = wrap.request?.headers?.get?.("Authorization") ?? null
    return {
      hasData: !!wrap.data,
      dataLen: Array.isArray(wrap.data) ? wrap.data.length : "not-array",
      errorPreview: JSON.stringify(wrap.error)?.slice(0, 200),
      status: wrap.response?.status,
      statusText: wrap.response?.statusText,
      requestUrl: wrap.request?.url,
      requestMethod: wrap.request?.method,
      authHeader: auth ? `${auth.slice(0, 20)}...` : "(none)",
    }
  }

  /**
   * Archive 一个 opencode session(plugin 创建的 system session 用,GUI sidebar 默认不显)。
   *
   * 通过 v1 SDK 的 raw `_client.patch`(其 update 类型 schema stale 不含 time.archived,
   * 但 server 端实际接受 — 用 cast 绕过 type 限制)。
   */
  private async archiveSession(sessionID: string): Promise<void> {
    const rawClient = (this.opts.opencodeClient as unknown as { _client?: unknown })._client
    if (!rawClient || typeof (rawClient as { patch?: unknown }).patch !== "function") {
      throw new Error("opencode SDK client missing internal _client.patch")
    }
    await (rawClient as { patch: (req: unknown) => Promise<unknown> }).patch({
      url: "/session/{id}",
      path: { id: sessionID },
      query: { directory: IMBOT_WORKSPACE },
      body: {
        time: { archived: Date.now() },
      },
    })
  }

  /**
   * 给 user 的消息加 emoji reaction,告诉 user "消息收到、正在响应"。
   * 同 OpenClaw 飞书桥接默认 ack 行为(避免 LLM 慢响应时 user 不知 plugin 是不是死了)。
   * "OK" 是飞书内置 emoji_type 之一,显示成 ✅ 类似的勾选标记。
   */
  private async ackMessage(messageId: string): Promise<void> {
    await this.larkClient.im.v1.messageReaction.create({
      data: { reaction_type: { emoji_type: "OK" } },
      path: { message_id: messageId },
    })
  }

  private async sendFeishuText(chatId: string, text: string): Promise<void> {
    await this.larkClient.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    })
  }
}

// ============================================================
// findLastUsefulAssistant — 倒序找有内容的 assistant message
// ============================================================
//
// 背景:opencode agent loop 在某些回复(工具调用 / 多步)尾部会追加一条 0-token 空 step
// placeholder message,parts 形状固定为 step-start → text("") → step-finish,parentID 跟
// 它前面那条真 reply 的 parentID 一样,瞬时完成(time.completed === time.created)。
// 简单倒序找 last assistant 会取到这条 placeholder → 返回空字符串 → 飞书侧没回复。
//
// 修法:倒序时跳过空 placeholder(无 error 且无非空 text part),继续往前找真 reply。
// 短回复(无 placeholder 跟随)不受影响 — 倒序第一条就是真 reply 命中。
//
// 此函数纯函数,作为 Logic 清单覆盖到 100% 行(R5 关键模块清单 helper extract 模式)。

/** SDK session.messages 返回 entry 的子集类型(仅本 helper 需要的字段)*/
export type AssistantMessageEntry = {
  info: {
    id?: string
    role?: string
    parentID?: string
    error?: { message?: string; data?: { message?: string } }
  }
  parts: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean }>
}

/**
 * 倒序找当前 turn 里最近一条"有用"的 assistant message。
 *
 * 有用 = 有 error(error 也是有效信号,caller 会抛出去)或 有非空 text part。
 * 跳过条件 = 0-token / 空文本 placeholder ghost(text 全空 + 无 error)。
 *
 * **本轮约束**:只考虑 `parentID === userMsgId` 的 assistant message。前一轮的 assistant
 * 不会被误取(2026-05-11 修;之前没此约束,reject 时本轮 assistant 无 text + 没 info.error
 * 被识别为 ghost 跳过 → 倒序回退到上一轮 assistant text → 把上一轮答案重发到飞书 →
 * user 看到"已拒绝"卡片但仍收到旧答案,严重安全感问题)。
 *
 * 返回 undefined → 本轮没有任何 useful assistant message,caller 应返空字符串。
 */
export function findLastUsefulAssistant(
  data: ReadonlyArray<AssistantMessageEntry>,
  userMsgId?: string,
): AssistantMessageEntry | undefined {
  for (let i = data.length - 1; i >= 0; i--) {
    const m = data[i]
    if (!m || m.info.role !== "assistant") continue
    // 本轮约束:assistant.parentID 必须等于 userMsgId(本轮触发的 user msg)
    // 没传 userMsgId 时退化成"任何轮"行为,兼容旧 caller(测试 / 回归保留)
    if (userMsgId !== undefined && m.info.parentID !== userMsgId) continue

    if (m.info.error) return m

    const hasRealText = m.parts.some(
      (p) =>
        p.type === "text" &&
        typeof p.text === "string" &&
        p.text.trim() !== "" &&
        !p.synthetic &&
        !p.ignored,
    )
    if (hasRealText) return m
    // 否则:placeholder ghost,继续往前扫(仍受 parentID 约束)
  }
  return undefined
}
