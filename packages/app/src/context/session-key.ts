// FORK: REQ-041/042 — 文件 tab 项目级存储 + 会话级伪标签合成的纯函数(零依赖,便于单测)。2026-06-02

// sessionKey 形如 `${dir}` 或 `${dir}/${sessionId}`(dir 为 base64)。文件 tab 按「项目 dir」段存储:
// 同项目不同会话(dir/idA、dir/idB)→ 同一 key → 共享一套文件 tab,切会话不变;
// 切项目(dirA、dirB)→ 不同 key → 各自一套。
export const projectTabKey = (sessionKey: string) => sessionKey.split("/")[0]

// 项目级文件 tab:打开的文件列表 + 当前选中的文件 tab。
export type ProjectTabs = { all: string[]; active?: string }

// 会话级伪标签:「审查/上下文」tab 的 active + 「上下文」tab 是否打开。这俩是**会话**概念,不能跟
// 项目级文件 tab 一起共享,否则切会话会串味(REQ-042 #3)。
export type SessionPseudoTab = { active?: "review" | "context"; context?: boolean }

// 合成给 UI 的 { all, active }:文件 tab(项目级)+ 会话级伪标签。
// - context 打开时把 "context" 拼到文件 tab 最前(保持原「context 在 all 开头」语义);
// - active 优先取会话伪标签(review/context),否则取项目级文件 active。
export const synthTabs = (files: ProjectTabs, pseudo?: SessionPseudoTab): ProjectTabs => ({
  all: pseudo?.context ? ["context", ...files.all] : files.all,
  active: pseudo?.active ?? files.active,
})
