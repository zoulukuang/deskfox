// FORK: REQ-119 — 聊天引用伪路径的跨端契约(前后端共享)。[feat: req-119-chat-selection-pseudo-path] 2026-08-19
//
// 「加入聊天」选中的是**对话区的一段文字**,不是磁盘上的文件,但引用卡沿用了 file 附件的
// 数据结构,于是塞了一个固定伪路径当占位符。它只是标识,任何"按 path 读盘/打开文件"的链路
// 都必须先排除它。此前这条约定只写在 app 侧注释里,后端收不到 —— 结果 prompt.ts 把它当真
// 文件去 execRead,每次引用都往模型上下文注入一对假的 Read 调用 + 失败结果(实测 294 次引用
// 命中 275 次,持续两个多月),并 publish 一条 Session.Event.Error。
//
// 把常量 + 判定挪到 core,让两端引用同一份定义,注释里的约定升级成代码里的守卫。

/** 聊天引用(选中对话文字「加入聊天」)使用的固定伪路径。**它永远不对应真实文件。** */
export const CHAT_SELECTION_PATH = "<chat selection>"

/**
 * 判断一个路径是否为聊天引用伪路径。
 *
 * 覆盖裸伪路径(`<chat selection>`)与被拼到 cwd 后面的形态
 * (posix `/repo/<chat selection>`、Windows `D:\repo\<chat selection>`)。
 */
export function isChatSelectionPath(input: string | undefined | null): boolean {
  if (!input) return false
  const trimmed = input.trim()
  if (!trimmed) return false
  const basename = trimmed.split(/[\\/]/).pop()
  return basename === CHAT_SELECTION_PATH
}
