// FORK: 多选拖动从 file-tree 到聊天 — pure helper,无 context 依赖,便于单测
// file-tree 多选拖动写 `application/x-deskfox-paths` MIME = JSON[abs paths](file-tree-dnd 内部 move 用 abs)
// 这里把它转成项目根下的相对路径列表(@-mention 期望 rel)。
// 边界:JSON 损坏 / 非数组 / 路径不在 root 下 / 路径含 Win 反斜杠 / 非字符串条目 全部容错。
// 2026-05-15 [feat: file-tree-multi-drag-to-chat]

export function parseMultiPathDropPaths(json: string | null | undefined, root: string | undefined): string[] {
  if (!json) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: string[] = []
  for (const abs of parsed) {
    if (typeof abs !== "string" || !abs) continue
    out.push(absToRelPath(abs, root))
  }
  return out
}

/**
 * 绝对路径 → @-mention 用的路径:**归一化 Win 反斜杠** + 在项目根下时转相对。
 *
 * FORK 2026-08-14:原为本文件私有,现导出给外部拖入复用
 * ([feat: external-drop-path-ref])。两条拖入路径必须产出**同一种**路径写法,
 * 否则同一个文件从文件树拖是相对路径、从访达拖是绝对路径,模型看到两种引用。
 */
export function toMentionPath(abs: string, root: string | undefined): string {
  return absToRelPath(abs, root)
}

/**
 * 只做**分隔符归一化**(Win 反斜杠 → 正斜杠),不动相对/绝对。
 *
 * 给的是**已经相对于项目根**的路径时用这个 —— 走 `toMentionPath(p, root)` 也能得到同样结果
 * (相对路径不以 root 开头,会原样返回归一化后的值),但那读起来像是在做相对化,
 * 容易让下一个人以为需要传 root。分开命名,意图直白。
 *
 * FORK 2026-08-14 [feat: external-drop-path-ref]:
 * [bug-repro: Windows 上文件树单选拖入聊天框插的是 `@docs\x.md`(反斜杠原样),
 *  而 `@` 提及补全、文件树多选拖入、外部拖入三条通道给的都是 `@docs/x.md`(正斜杠)——
 *  同一个文件出现两种引用写法,正是本 feat 要消除的那个不变式,在 Win 上并未成立。
 *  Mac 上路径本来就是正斜杠,这条路径永远暴露不出来。]
 */
export function toMentionSeparators(path: string): string {
  return path.replace(/\\/g, "/")
}

function absToRelPath(abs: string, root: string | undefined): string {
  const normAbs = toMentionSeparators(abs)
  if (!root) return normAbs
  const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "")
  if (normAbs === normRoot) return ""
  if (normAbs.startsWith(normRoot + "/")) return normAbs.slice(normRoot.length + 1)
  // abs 不在 root 下(罕见,跨盘符 / 外部拖入),原样返回(LLM 拿完整路径)
  return normAbs
}
