// FORK: REQ-123 — 用户消息动作条(Agent · 模型 · 时间 + 撤回 + 复制)的显示判定。
// fork-only 新文件:上游把这个条件内联写在 UserMessageDisplay 的 JSX 里,而它写窄了 ——
// 只认"有正文",于是经典布局下**没有正文的消息**(聊天引用卡片 / 纯图片 / 纯附件)
// 整条动作条都不渲染,撤回按钮跟着一起消失(能力其实在,`actions.revert` 一路传到位)。
// 抽成纯函数是为了能单测(session-ui 无组件渲染测试设施,走 helper extract 模式,见 R5 双清单)。
// 2026-08-19
export function shouldShowUserMessageActions(input: {
  /** 非 synthetic 的正文 text part 内容(有正文 = 上游原判据) */
  hasText: boolean
  /** 动作条里是否有可用动作 —— 目前只有撤回;没有正文时它是动作条存在的唯一理由 */
  canRevert: boolean
  /** V2 布局把引用卡片内联进消息体,卡片本身就是内容 */
  hasInlineComments: boolean
  /** 是否 V2 动作条布局(经典布局下卡片走独立的 CommentStrip 行,不算内联) */
  useV2Actions: boolean
}) {
  if (input.hasText) return true
  if (input.canRevert) return true
  return input.useV2Actions && input.hasInlineComments
}
