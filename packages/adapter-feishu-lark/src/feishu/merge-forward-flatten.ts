// FORK: 飞书合并转发(merge_forward)消息 flatten 纯函数
// [feat: feishu-merge-forward] 2026-05-26
//
// 把飞书 `client.im.v1.message.get` 拉到的子消息列表(items[])flatten 成:
//   - 单字符串 text(给 LLM 看的对话纪要,含 sender 前缀 / 占位符 / 末尾省略提示)
//   - images[](待 caller 用 image-downloader 下载并加 file part)
//
// 设计要点:
//   - **纯函数**(0 IO,易测,M1-M12 全 unit 覆盖)
//   - **按 create_time 升序**(R2,飞书 API 不保证有序)
//   - **MAX_SUB_MESSAGES=50 截断**(D3 + R3)
//   - **MAX_IMAGE_COUNT=5 截断**(D1 + R4 vision-incapable 时 0)
//   - **嵌套 merge_forward depth≥2 占位**(D4,实际递归在 pipeline 层处理)
//   - **群聊 vs p2p sender 处理**(D5)
//   - **中文 user 视角占位 + 元信息**(D6)
//
// caller(pipeline.handle())责任:
//   - vision 预检(R4)→ 决定 maxImages
//   - 实际 fetch + 下载 image(继承 image-downloader S1-S5)
//   - 嵌套递归 1 层(同步在 pipeline 内,不在本 helper)

/** 子消息(SDK `im.v1.message.get` 返 items 元素的子集,仅本 helper 用到的字段) */
export interface SubMessage {
  message_id?: string
  msg_type?: string
  body?: { content?: string }
  sender?: { id?: string }
  create_time?: string // ms 字符串,parseInt 排序
  upper_message_id?: string
  // 其他字段(root_id / parent_id / chat_id 等)本 helper 不需要
}

/** flatten 后给 LLM 的结构化结果 */
export interface FlattenResult {
  /** flatten 后的纯文本(已含 sender 前缀 / 占位符 / 末尾省略提示)*/
  text: string
  /** 要下载并加 file part 的图(MAX_IMAGE_COUNT 内,按出现顺序)*/
  images: Array<{
    imageKey: string
    subMessageId: string
    /** 1-based,用于占位文案对应(第 N 张图)*/
    indexInForward: number
  }>
}

export interface FlattenOptions {
  /** 是否在每条前加 sender 名字前缀(p2p=false / 群=true,D5)*/
  withSender: boolean
  /** 子消息上限,超出截断 + 末尾"还有 N 条未显示"*/
  maxSubMessages: number
  /** 图上限,超出占位 `[图 N(未展开)]`(vision-incapable 时传 0 → 纯文本 flatten)*/
  maxImages: number
  /** 当前嵌套深度(0=顶层,≥2 时占位)*/
  depth: number
}

export const MAX_SUB_MESSAGES = 50
export const MAX_IMAGE_COUNT = 5
/** depth=0 顶层 / depth=1 1 层递归 / depth≥2 全占位 */
export const MAX_NEST_DEPTH = 1

/** 按 create_time 升序(R2)— 飞书 API 不保证有序 */
export function sortByCreateTime(items: SubMessage[]): SubMessage[] {
  return [...items].sort((a, b) => {
    const ta = parseInt(a.create_time ?? "0", 10)
    const tb = parseInt(b.create_time ?? "0", 10)
    return ta - tb
  })
}

/** sender open_id 简显前 6 位(D5,sender_id → 用户名映射留 backlog)*/
function senderTag(item: SubMessage): string {
  const senderId = item.sender?.id ?? ""
  if (!senderId) return "未知"
  return senderId.slice(0, 6)
}

/** 提 post msg_type 的 textContent(同 message-pipeline.ts parseMessageContent post 分支)*/
function extractPostText(contentJson: string): { text: string; imageKey: string | null } {
  try {
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
        if (seg.tag === "text" && typeof seg.text === "string" && seg.text) textParts.push(seg.text)
        if (
          (seg.tag === "img" || seg.tag === "image") &&
          typeof seg.image_key === "string" &&
          !imageKey
        )
          imageKey = seg.image_key
      }
    }
    return { text: textParts.join(" ").trim(), imageKey }
  } catch {
    return { text: "", imageKey: null }
  }
}

/** humanSize for file metadata in 占位文案 */
function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ""
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

/**
 * 渲染单条子消息为一行文本(纯函数,占位符 + 元信息)
 *
 * 注:image / post 内的 image_key 提取**不**在这里做,由主 flatten 入口统一处理
 * (因为还要看 maxImages 上限 + 维护 indexInForward 计数器)。
 *
 * 参数:
 *   - imageRendered:该消息的 image 已被加入 images[]?(true → 占位 `[图片(已展开识别)]`,
 *     false → `[图 N(未展开)]`)
 *   - imageGlobalIndex:1-based 全局图序号(用于占位 `[图 N(未展开)]`)
 *   - depth:嵌套深度(检查嵌套 merge_forward 是否需要占位)
 */
export function renderSubMessage(
  item: SubMessage,
  withSender: boolean,
  imageRendered: boolean,
  imageGlobalIndex: number,
  depth: number,
): string {
  const msgType = item.msg_type ?? "unknown"
  const senderPrefix = withSender ? `[${senderTag(item)}]: ` : ""
  const contentJson = item.body?.content ?? "{}"

  let bodyText: string

  switch (msgType) {
    case "text": {
      try {
        const parsed = JSON.parse(contentJson) as { text?: string }
        bodyText = (parsed.text ?? "").trim()
      } catch {
        bodyText = "[文本解析失败]"
      }
      break
    }
    case "image": {
      bodyText = imageRendered ? `[图片(已展开识别)]` : `[图 ${imageGlobalIndex}(未展开)]`
      break
    }
    case "post": {
      const post = extractPostText(contentJson)
      // post 的图也算图,占位跟 image 同款
      const imgPart = post.imageKey
        ? imageRendered
          ? ` [图片(已展开识别)]`
          : ` [图 ${imageGlobalIndex}(未展开)]`
        : ""
      bodyText = (post.text || "[富文本]") + imgPart
      break
    }
    case "file": {
      try {
        const parsed = JSON.parse(contentJson) as { file_name?: string; file_size?: string }
        const name = parsed.file_name ?? "未命名"
        const size = parsed.file_size ? humanSize(parseInt(parsed.file_size, 10)) : ""
        bodyText = size ? `[文件: ${name} ${size}]` : `[文件: ${name}]`
      } catch {
        bodyText = `[文件]`
      }
      break
    }
    case "audio": {
      try {
        const parsed = JSON.parse(contentJson) as { duration?: string | number }
        const dur = parsed.duration ? Math.round(Number(parsed.duration) / 1000) : 0
        bodyText = dur > 0 ? `[语音 ${dur}s]` : `[语音]`
      } catch {
        bodyText = `[语音]`
      }
      break
    }
    case "media":
    case "video": {
      try {
        const parsed = JSON.parse(contentJson) as { duration?: string | number }
        const dur = parsed.duration ? Math.round(Number(parsed.duration) / 1000) : 0
        bodyText = dur > 0 ? `[视频 ${dur}s]` : `[视频]`
      } catch {
        bodyText = `[视频]`
      }
      break
    }
    case "sticker": {
      bodyText = `[表情]`
      break
    }
    case "share_chat": {
      try {
        const parsed = JSON.parse(contentJson) as { chat_id?: string }
        bodyText = parsed.chat_id ? `[分享: 群 ${parsed.chat_id.slice(0, 8)}]` : `[分享: 群]`
      } catch {
        bodyText = `[分享: 群]`
      }
      break
    }
    case "share_user": {
      try {
        const parsed = JSON.parse(contentJson) as { user_id?: string }
        bodyText = parsed.user_id ? `[分享: 用户 ${parsed.user_id.slice(0, 6)}]` : `[分享: 用户]`
      } catch {
        bodyText = `[分享: 用户]`
      }
      break
    }
    case "merge_forward": {
      if (depth >= MAX_NEST_DEPTH) {
        bodyText = `[嵌套合并消息(深度超限)]`
      } else {
        // depth < MAX_NEST_DEPTH 时这条会被 pipeline 层同步递归展开,
        // 这里返占位让 caller 知道"该位置后会拼递归内容"
        bodyText = `[嵌套合并消息(展开中)]`
      }
      break
    }
    default: {
      bodyText = `[未知消息类型: ${msgType}]`
      break
    }
  }

  return senderPrefix + bodyText
}

/**
 * 主 flatten 入口(纯函数,无 IO)
 *
 * 流程:
 *   1. sortByCreateTime(R2 时间序)
 *   2. slice 到 maxSubMessages(D3 截断)
 *   3. 遍历:每条 image / post-with-image 占用 1 个 image 配额(D1 maxImages 内 push 到 images[])
 *   4. renderSubMessage(每条变一行文本)
 *   5. 超截断的末尾加 `... 还有 N 条未显示`
 */
export function flattenMergeForward(
  items: SubMessage[],
  options: FlattenOptions,
): FlattenResult {
  const { withSender, maxSubMessages, maxImages, depth } = options

  // R2 时间序
  const sorted = sortByCreateTime(items)

  // D3 截断
  const truncated = sorted.length > maxSubMessages
  const visibleItems = truncated ? sorted.slice(0, maxSubMessages) : sorted
  const overflowCount = truncated ? sorted.length - maxSubMessages : 0

  const lines: string[] = []
  const images: FlattenResult["images"] = []
  // 全局图计数(独立于 images.length — 未展开的图也算入序号)
  let imageCountTotal = 0

  for (const item of visibleItems) {
    const msgType = item.msg_type ?? "unknown"

    // 提取该消息的 image_key(若存在)
    let imageKey: string | null = null
    if (msgType === "image") {
      try {
        const parsed = JSON.parse(item.body?.content ?? "{}") as { image_key?: string }
        imageKey = parsed.image_key ?? null
      } catch {
        imageKey = null
      }
    } else if (msgType === "post") {
      imageKey = extractPostText(item.body?.content ?? "{}").imageKey
    }

    // 决定该消息的图是否被展开(maxImages 配额内 + 真有 image_key + 子消息有 ID)
    const subMessageId = item.message_id
    const canExpand =
      imageKey !== null &&
      subMessageId !== undefined &&
      images.length < maxImages

    // 全局图序号(用于占位 `[图 N(未展开)]` 让 LLM 能引用具体哪张)
    const imageGlobalIndex = imageKey ? ++imageCountTotal : 0

    if (canExpand && imageKey && subMessageId) {
      images.push({
        imageKey,
        subMessageId,
        indexInForward: imageGlobalIndex,
      })
    }

    const line = renderSubMessage(
      item,
      withSender,
      canExpand,
      imageGlobalIndex,
      depth,
    )
    lines.push(line)
  }

  // 末尾省略提示(D3)
  if (truncated) {
    lines.push(`... 还有 ${overflowCount} 条未显示`)
  }

  return {
    text: lines.join("\n"),
    images,
  }
}

/**
 * 判断 items 是否含**至少一张** image(用于 vision-incapable model 友好提示决策)。
 * 仅查 msg_type='image' / 'post' with image_key,不递归嵌套 merge_forward(嵌套占位本身不算图)。
 */
export function hasAnyImage(items: SubMessage[]): boolean {
  for (const item of items) {
    if (item.msg_type === "image") {
      try {
        const parsed = JSON.parse(item.body?.content ?? "{}") as { image_key?: string }
        if (parsed.image_key) return true
      } catch {
        // ignore
      }
    } else if (item.msg_type === "post") {
      if (extractPostText(item.body?.content ?? "{}").imageKey) return true
    }
  }
  return false
}
