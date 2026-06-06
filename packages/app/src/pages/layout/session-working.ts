// FORK-ONLY: stuck-working-indicator-fix [feat: stuck-working-indicator-fix] 2026-06-06
//
// 会话列表"运行中"旋转图标的判定逻辑(从 sidebar-items.tsx 的 isWorking createMemo 抽出的纯函数,
// 进 Logic 清单可单测)。
//
// 关键修复:pending 信号只看"最后一条是不是未完成的 assistant 消息"。原实现 findLast 会扫到埋在
// 历史里、被硬杀漏盖 time.completed 的残骸消息,导致图标永久卡死;直播流式中在途消息恒为最后一条,
// 语义不变。后端 heal-interrupted 负责补盖残骸 completed。详见 docs/features/stuck-working-indicator-fix/

type WorkingMessage = { role?: string; time?: { created?: unknown; completed?: unknown } }
type WorkingStatus = { type?: string } | undefined

export function deriveSessionWorking(input: {
  hasPermissions: boolean
  messages: ReadonlyArray<WorkingMessage> | undefined
  status: WorkingStatus
}): boolean {
  if (input.hasPermissions) return false
  const messages = input.messages ?? []
  const last = messages[messages.length - 1]
  const pending = last?.role === "assistant" && typeof last.time?.completed !== "number"
  const status = input.status
  return (
    pending ||
    status?.type === "busy" ||
    status?.type === "retry" ||
    (status !== undefined && status.type !== "idle")
  )
}
