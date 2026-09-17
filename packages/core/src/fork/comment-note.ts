// FORK-ONLY: 引用注释的 LLM 模板与解析器 —— 前后端唯一真源
// [feat: release-closeout-2026-09] 2026-09-17
//
// 为什么住在 packages/core:
//   REQ-125 要在服务端 ensureTitle 喂小模型**之前**把这层模板剥掉,于是 packages/opencode 也得
//   用上 parseCommentNote。而它原先住在 packages/app(前端包),后端 import 不到 —— 照抄一份
//   就意味着"模板"和"对偶正则"从此分居两地,谁改了一边忘了另一边,剥壳会**静默失效**
//   (标题悄悄退回英文样板,没有任何报错)。
//   packages/core 是 packages/app 与 packages/opencode 的共同 workspace 依赖,放这里两边
//   import 同一份,没有副本,也就没有同步问题。
//
// 本文件是纯字符串函数、零运行时依赖,浏览器与 Node 两端都安全。
// packages/app/src/utils/comment-note.ts 现在只是对本文件的 re-export,调用方一处未改。
//
// ⚠️ 模板(formatCommentNote)与解析器(parseCommentNote)是**对偶**关系,必须一起改。
//    comment-note.test.ts 里有一条往返契约测试钉着这件事:parse(format(x)) 必须还原 x。

/** 引用选区。与 packages/app 的 FileSelection 结构一致(刻意不 import,core 不该依赖前端包)。 */
export type CommentSelection = {
  startLine: number
  startChar: number
  endLine: number
  endChar: number
}

export type PromptComment = {
  path: string
  selection?: CommentSelection
  comment: string
  preview?: string
  origin?: "review" | "file" | "quote"
  // FORK: quote 子分类 — "chat" = 聊天引用走 LLM 模板分流;"file" / undefined = 文件引用
  // [feat: 聊天选区-卡片化-换行] 2026-05-25
  kind?: "chat" | "file"
}

function selection(selection: unknown) {
  if (!selection || typeof selection !== "object") return undefined
  const startLine = Number((selection as CommentSelection).startLine)
  const startChar = Number((selection as CommentSelection).startChar)
  const endLine = Number((selection as CommentSelection).endLine)
  const endChar = Number((selection as CommentSelection).endChar)
  if (![startLine, startChar, endLine, endChar].every(Number.isFinite)) return undefined
  return {
    startLine,
    startChar,
    endLine,
    endChar,
  } satisfies CommentSelection
}

export function createCommentMetadata(input: PromptComment) {
  return {
    opencodeComment: {
      path: input.path,
      selection: input.selection,
      comment: input.comment,
      preview: input.preview,
      origin: input.origin,
      kind: input.kind,
    },
  }
}

export function readCommentMetadata(value: unknown) {
  if (!value || typeof value !== "object") return
  const meta = (value as { opencodeComment?: unknown }).opencodeComment
  if (!meta || typeof meta !== "object") return
  const path = (meta as { path?: unknown }).path
  const comment = (meta as { comment?: unknown }).comment
  if (typeof path !== "string" || typeof comment !== "string") return
  const preview = (meta as { preview?: unknown }).preview
  const origin = (meta as { origin?: unknown }).origin
  const kind = (meta as { kind?: unknown }).kind
  return {
    path,
    selection: selection((meta as { selection?: unknown }).selection),
    comment,
    preview: typeof preview === "string" ? preview : undefined,
    origin: origin === "review" || origin === "file" || origin === "quote" ? origin : undefined,
    kind: kind === "chat" || kind === "file" ? kind : undefined,
  } satisfies PromptComment
}

export function formatCommentNote(input: {
  path: string
  selection?: CommentSelection
  comment: string
  preview?: string
  kind?: "chat" | "file"
}) {
  // FORK: kind="chat" 走聊天引用模板,让 LLM 明白引文来自同一对话历史(继承上下文)
  // [feat: 聊天选区-卡片化-换行] 2026-05-25
  if (input.kind === "chat") {
    const preview = input.preview?.trim()
    const quoteSection = preview
      ? `The user is quoting text from earlier in this conversation:\n"""\n${preview}\n"""\n\n`
      : ""
    return `${quoteSection}Their follow-up question/comment: ${input.comment}`
  }

  const start = input.selection ? Math.min(input.selection.startLine, input.selection.endLine) : undefined
  const end = input.selection ? Math.max(input.selection.startLine, input.selection.endLine) : undefined
  const range =
    start === undefined || end === undefined
      ? "this file"
      : start === end
        ? `line ${start}`
        : `lines ${start} through ${end}`
  const head = `The user made the following comment regarding ${range} of ${input.path}: ${input.comment}`
  const preview = input.preview?.trim()
  if (!preview) return head
  return `${head}\n\nSelected text:\n"""\n${preview}\n"""`
}

export function parseCommentNote(text: string) {
  const match = text.match(
    /^The user made the following comment regarding (this file|line (\d+)|lines (\d+) through (\d+)) of (.+?): ([\s\S]+?)(?:\n\nSelected text:\n"""\n[\s\S]*?\n""")?$/,
  )
  if (!match) return
  const start = match[2] ? Number(match[2]) : match[3] ? Number(match[3]) : undefined
  const end = match[2] ? Number(match[2]) : match[4] ? Number(match[4]) : undefined
  return {
    path: match[5],
    selection:
      start !== undefined && end !== undefined
        ? {
            startLine: start,
            startChar: 0,
            endLine: end,
            endChar: 0,
          }
        : undefined,
    comment: match[6],
  } satisfies PromptComment
}

// FORK: REQ-125 会话标题剥壳 [feat: release-closeout-2026-09] 2026-09-17
//
// 「加入聊天」发起的会话,标题清一色 `User Made Following Comment Regarding File`。
// 三段相乘、非模型抖动:
//   ① formatCommentNote 把用户注释包进英文样板,真实意图被压到冒号之后;
//   ② ensureTitle 拿这条首消息**原样**喂 title agent + small model;
//   ③ title.txt 的规则洗掉 the/this,且"跟随用户消息语言" —— 模板是英文,于是中文提问也出英文标题。
// 模板恒定 ⇒ 输出恒定。修法是在喂模型前把壳剥掉,只送用户真写的那句话 + 文件名。
//
// 放在本文件而不是 packages/opencode,是因为它与上面两个模板是**对偶**关系,必须贴身同住:
// 分开放就等着某次改了模板忘了改这里,标题静默退回英文样板且无任何报错。
// 两个模板长得完全不一样(文件引用 vs 聊天引用),一个正则接不住,故分别判断。

/** 聊天引用模板的对偶正则 —— 与 formatCommentNote 的 kind==="chat" 分支严格对应 */
const CHAT_NOTE_RE =
  /^(?:The user is quoting text from earlier in this conversation:\n"""\n[\s\S]*?\n"""\n\n)?Their follow-up question\/comment: ([\s\S]+)$/

/**
 * 把引用注释的 LLM 样板剥掉,取出「用户真写的那句话」(文件引用再附上文件名)。
 *
 * 返回 undefined = 这段文本不是引用注释模板,调用方应原样透传(普通消息不该被动)。
 */
export function stripCommentNoteForTitle(text: string): string | undefined {
  const file = parseCommentNote(text)
  if (file) {
    const name = file.path.split(/[\\/]/).pop() || file.path
    const comment = file.comment.trim()
    if (!comment) return name
    return `${comment}\n(${name})`
  }
  const chat = CHAT_NOTE_RE.exec(text)
  if (chat) {
    const comment = chat[1]?.trim()
    return comment || undefined
  }
  return undefined
}

// FORK: 引用卡片的"引文标签" —— 时间线上有**两条**渲染路径,必须共用同一份实现
// [feat: release-closeout-2026-09] 2026-09-17
//
// 起因:REQ-131 首版只改了 CommentCardV2(v2 布局),漏了 message-timeline.tsx 的 CommentStrip 行
// (经典布局),后者仍拿 path 当文件名渲染 → 聊天引用卡片上赫然印着 `<chat selection>`,
// 用户 2026-09-17 真机截图反馈「提交之后看不出来提交的是什么内容」。
// 两条路径分居 packages/session-ui 与 packages/app,唯一能共用的地方就是 core。
// 放这里不是为了优雅,是为了下次再有人改一处漏一处时,至少标签逻辑不会漂。

/** 聊天引用副标题上的引文标签:取引文首个非空行,过长截断。无引文返回 undefined,由调用方决定回退文案。 */
export function commentQuoteLabel(preview: string | undefined, maxLength = 24): string | undefined {
  const first = preview
    ?.split("\n")
    .find((line) => line.trim().length > 0)
    ?.trim()
  if (!first) return undefined
  return first.length > maxLength ? `${first.slice(0, maxLength)}\u2026` : first
}

/**
 * 「加入聊天」未填注释时塞进 comment 的英文占位。
 *
 * 它存在的理由是历史的(早期 formatCommentNote 无 comment 就返回空串),**如今已不需要** ——
 * build-request-parts 的 `if (!comment && !preview)` 闸保证了"有引文即使无注释"也照发完整引用。
 * 但它已经写进了历史消息的 metadata,所以不能直接删:渲染层见到它要当"用户什么都没写"处理,
 * 否则用户会在自己的引用卡片上看到一句莫名其妙的英文(2026-09-17 真机截图即此)。
 */
export const EMPTY_COMMENT_PLACEHOLDER = "(see selected text)"

/** 这条 comment 是不是"用户其实什么都没写"(空 / 仅空白 / 历史占位)。渲染层据此决定不显示正文。 */
export function isBlankComment(comment: string | undefined): boolean {
  const trimmed = comment?.trim()
  if (!trimmed) return true
  return trimmed === EMPTY_COMMENT_PLACEHOLDER
}
