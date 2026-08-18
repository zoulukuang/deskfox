import { type ContextItem, type Prompt, type usePrompt } from "@/context/prompt"

type PromptTarget = ReturnType<ReturnType<typeof usePrompt>["capture"]>

export function createPromptSubmissionState(input: {
  target: PromptTarget
  prompt: Prompt
  context: (ContextItem & { key: string })[]
}) {
  const initial = input.target
  let target = input.target
  let cleared: Prompt | undefined

  return {
    prompt: input.prompt,
    context: input.context,
    target: () => target,
    clear() {
      if (initial !== target) {
        initial.reset()
        // FORK-BEGIN: REQ-116 —— reset() 只重置文本,initial(新会话态的 workspace 草稿)的
        //   context.items 不清 → 已发送的评论卡/附件卡永久留在草稿里,下一条新会话消息会把它们
        //   再发一次给模型;又因走 per-project 持久化草稿,不会自愈。
        //   retarget 已把这些卡交接给新会话 scope,此处清 initial 不丢内容。
        //   仅在 initial !== target(即真的 retarget 过)时触发,现有会话流的上游语义不动。
        //   [feat: session-presentation-input-batch] 2026-08-17
        for (const item of initial.context.items().slice()) initial.context.remove(item.key)
        // FORK-END
      }
      target.reset()
      cleared = target.current()
    },
    retarget(next: PromptTarget) {
      input.context.forEach(next.context.add)
      target = next
    },
    current: (value: PromptTarget) => target === value,
    restore() {
      if (cleared !== undefined && target.current() !== cleared) return
      return { target, prompt: input.prompt, context: input.context }
    },
  }
}
