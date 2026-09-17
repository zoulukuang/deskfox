// FORK-ONLY: 上下文项的「能不能发」与「发完清哪些」(纯逻辑)
// [feat: release-closeout-2026-09] 2026-09-17
//
// [bug-repro-1: 文件预览区选中文字「加入聊天」后不再输入任何文字就**无法提交**,
//               而同样的动作在聊天区却能提交]
// [bug-repro-2: 消息发出去了输入框仍留着那张卡片;更要紧的是它还在 context 里,
//               下一条消息会把同一个文件再发给模型一次,用户看不出来]
//
// 两个 bug 同一个病根:判定与清理都只认「有注释的」上下文项。
//
// 选区加入聊天其实有**三条**独立实现,对空注释的处理各不相同:
//   · 聊天区 / PDF-office → utils/context-menu-host/host.tsx,空注释时塞英文占位 "(see selected text)"
//   · md/文本/代码预览区   → pages/session/file-tabs.tsx,空注释时直接 comment: undefined
// 于是前者 commentCount>0 能提交、发完也被清掉;后者两样都落空。
//
// 数据层本来就支持空注释:build-request-parts 的 `if (!comment && !preview)` 闸保证
// 「有引文即使没注释」也照发完整引用给模型。所以修法是把判定/清理放宽到「所有 file 上下文项」,
// 而不是再给某一处补占位注释 —— 占位注释正是用户在卡片上看到那句莫名英文的来源。

/** 只取判定需要的字段,避免把整个 ContextItem 类型拖进纯逻辑层 */
export type ContextGateItem = { type: string; key: string }

/**
 * 参与「能不能发」判定的上下文项数。
 *
 * 与 commentCount 的区别:后者只数有注释的,且还要喂输入框 placeholder 文案(「N 条评论」),
 * 语义不能动;提交闸要的是「有没有东西可发」,所以另算一份。
 */
export function contextItemCount(items: readonly ContextGateItem[], mode: "normal" | "shell"): number {
  if (mode === "shell") return 0
  return items.length
}

/**
 * 发送后应当从输入框清掉的上下文项。
 *
 * 全部 file 项一视同仁 —— 有没有注释都是「已经跟着这条消息发出去了」。
 * queue 分支的 clearContext 本来就是全清,此处与之对齐。
 * 发送失败时 restoreCommentItems 会把它们原样还回来,语义不变。
 */
export function clearableContextItems<T extends ContextGateItem>(items: readonly T[]): T[] {
  return items.filter((item) => item.type === "file")
}
