// [fork-only] voice-acp-bridge — 三分法轮次判别 [feat: voice-acp-bridge] 2026-08-24
//
// 桥收到的每一条 `session/prompt` 都必须先回答一个问题:**这一轮是谁在说话、想要什么**。
// 答错的代价不是"效果差一点",而是递归派活 —— 一件事开出三条 session,历史互相污染,
// 用户看到的是列表里莫名其妙多出来的重复任务(voice-dispatch-minimal 时代的真实故障)。
//
// 1-spec §3.3 把判据定成**互斥三类**,而不是一个 bool。理由是实验 E4 的教训:
// 只判 `<qwen_audio_agent_backend_instructions>` 会把**结果回流轮**也算成"新请求"——
// 因为收尾轮同样被包了那个信封(`acp-backend-adapter.mjs:1255-1266` 走的还是 coordinatorTurn)。
// 于是 mock 在收尾轮又派了一次活,自己开出了第三条 session。
//
// ⚠️ 判据认**完整标签结构**,不认子串。
// 任务文本完全可能"提到"这些标记(用户转述任务、模型复述指令、日志片段被贴进来),
// 那时标记只是一段普通文字,不该改变轮次语义。所以要求:标记**独占一行**且**开闭配对**。

import {
  ENVELOPE_BACKEND_INSTRUCTIONS_CLOSE,
  ENVELOPE_BACKEND_INSTRUCTIONS_OPEN,
  ENVELOPE_DELEGATION_RESULT_CLOSE,
  ENVELOPE_DELEGATION_RESULT_OPEN,
} from "./contract"

/**
 * 三类轮次,互斥且穷尽:
 * - `delegation-result` 结果回流:第三层跑完了,coordinator 只负责整理成播报。**绝不再派活。**
 * - `coordinator` 新请求路由:用户刚说了话,coordinator 决定自己答还是派活。
 * - `task` 第三层任务:没有任何信封,拿到的就是一句干净的任务文本,埋头干完。
 */
export type TurnKind = "delegation-result" | "coordinator" | "task"

export interface TurnClassification {
  readonly kind: TurnKind
  /** 判成这一类的依据,进日志用 —— 出问题时能一眼看出是"没认出信封"还是"认错了" */
  readonly reason: string
}

/**
 * 标记是否以**完整标签结构**出现:开标签独占一行、闭标签独占一行、且开在闭之前。
 *
 * 「独占一行」是 qwen 的构造方式决定的 —— 信封由数组 `join("\n")` 拼出来
 * (`acp-backend-adapter.mjs:949-954`、`:1141-1155`),标记那一行前后不会有别的内容。
 * 反过来,被"提到"的标记几乎不可能独占一行,这就是我们区分真假的抓手。
 */
export function hasEnvelope(text: string, open: string, close: string): boolean {
  const lines = String(text ?? "").split("\n")
  let openAt = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (openAt < 0) {
      if (line === open) openAt = i
      continue
    }
    if (line === close) return true
  }
  return false
}

/**
 * 判定本轮属于哪一类。**顺序即优先级**:先看结果回流,因为收尾轮**两个信封都带**
 * (Gateway 把 delegation_result 当作新一轮 coordinator prompt 发出,照样包 backend_instructions)。
 * 判反了就是 E4 那个递归。
 */
export function classifyTurn(text: string): TurnClassification {
  const body = String(text ?? "")
  if (hasEnvelope(body, ENVELOPE_DELEGATION_RESULT_OPEN, ENVELOPE_DELEGATION_RESULT_CLOSE)) {
    return { kind: "delegation-result", reason: "带完整 delegation_result 信封 —— 第三层已完成,本轮只整理" }
  }
  if (hasEnvelope(body, ENVELOPE_BACKEND_INSTRUCTIONS_OPEN, ENVELOPE_BACKEND_INSTRUCTIONS_CLOSE)) {
    return { kind: "coordinator", reason: "带完整 backend_instructions 信封且无回流结果 —— 新请求路由轮" }
  }
  return { kind: "task", reason: "无信封 —— 第三层任务文本,直接执行" }
}

/**
 * 本轮**允许**派活吗。桥用它决定要不要把 qwen 的派活 MCP 挂到这条 session 上。
 *
 * 注意这只是第二道闸。第一道是结构性的:派活工具只注册给 voice 目录下的 coordinator session,
 * 而第三层 session 落在用户项目目录 —— MCP 状态按 directory 隔离(`mcp/index.ts` 的 InstanceState),
 * 它**结构上就拿不到** `session_start`。两道闸都过不去,递归才算真的不可能。
 */
export function mayDelegate(kind: TurnKind): boolean {
  return kind === "coordinator"
}

/** 把 ACP prompt 的 content block 数组拼成纯文本(只取 text,其余类型不参与轮次判别)。 */
export function promptText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ""
  const out: string[] = []
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue
    const block = b as { type?: unknown; text?: unknown }
    if (block.type === "text" && typeof block.text === "string") out.push(block.text)
  }
  return out.join("\n")
}
