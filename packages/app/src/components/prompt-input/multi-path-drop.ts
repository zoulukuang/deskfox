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

function absToRelPath(abs: string, root: string | undefined): string {
  const normAbs = abs.replace(/\\/g, "/")
  if (!root) return normAbs
  const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "")
  if (normAbs === normRoot) return ""
  if (normAbs.startsWith(normRoot + "/")) return normAbs.slice(normRoot.length + 1)
  // abs 不在 root 下(罕见,跨盘符 / 外部拖入),原样返回(LLM 拿完整路径)
  return normAbs
}
