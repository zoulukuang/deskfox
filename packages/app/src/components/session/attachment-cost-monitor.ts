import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"

export function inputTokens(message: AssistantMessage) {
  return message.tokens.input + message.tokens.cache.read + message.tokens.cache.write
}

type Sample = { user: string; value: number; model: string; epoch: string }

export function createAttachmentCostMonitor() {
  const sessions = new Map<string, { sample?: Sample; previous?: Sample; seen: Set<string> }>()
  return (input: { key: string; messages: Message[]; idle: boolean; reset?: string }) => {
    const user = input.messages.findLast((message) => message.role === "user")
    if (!user) return
    const last = input.messages.findLast((message) => message.role === "assistant" && message.parentID === user.id)
    if (
      !last ||
      last.role !== "assistant" ||
      !last.time.completed ||
      !input.idle ||
      last.summary ||
      !last.finish ||
      last.finish === "tool-calls"
    )
      return
    const value = inputTokens(last)
    if (!Number.isFinite(value) || value <= 0) return
    const summary = input.messages.findLast((message) => message.role === "assistant" && message.summary)
    const sample = {
      user: user.id,
      value,
      model: `${last.providerID}/${last.modelID}`,
      epoch: `${input.reset ?? ""}/${summary?.id ?? ""}`,
    }
    const state = sessions.get(input.key)
    if (!state) {
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!)
      sessions.set(input.key, { sample, seen: new Set([sample.user]) })
      return
    }
    // Completed/token/idle events may arrive separately. Keep the preceding user-turn baseline
    // until this turn has actually warned, so late cache counts can still cross the threshold.
    if (state.sample?.user !== sample.user) state.previous = state.sample
    state.sample = sample
    if (state.seen.has(sample.user)) return
    const previous = state.previous
    if (!previous || previous.model !== sample.model || previous.epoch !== sample.epoch) return
    if (value - previous.value < 100_000 || value < previous.value * 3) return
    state.seen.add(sample.user)
    return { previous: previous.value, current: value, user: sample.user }
  }
}
