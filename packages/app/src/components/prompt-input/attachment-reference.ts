import type { Prompt } from "@/context/prompt"

// Insert into the captured draft, never the editor belonging to a subsequently selected session.
export function insertAttachmentReference(prompt: Prompt, path: string, cursor = 0) {
  if (prompt.some((part) => part.type === "file" && part.path === path && !part.selection))
    return { parts: prompt, cursor }
  const content = "@" + path
  const result: Prompt = []
  const state = { position: 0, inserted: false, cursor: 0, next: 0 }
  const insert = (offset: number) => {
    result.push({ type: "file", path, content, start: 0, end: 0 }, { type: "text", content: " ", start: 0, end: 0 })
    state.inserted = true
    state.next = offset + content.length + 1
  }
  for (const part of prompt) {
    if (part.type === "image") {
      result.push(part)
      continue
    }
    const end = state.position + part.content.length
    if (!state.inserted && cursor <= end) {
      if (part.type === "text") {
        const at = Math.max(0, cursor - state.position)
        result.push({ ...part, content: part.content.slice(0, at) })
        insert(state.position + at)
        result.push({ ...part, content: part.content.slice(at) })
      } else {
        result.push(part)
        insert(end)
      }
    } else result.push(part)
    state.position = end
  }
  if (!state.inserted) insert(state.position)
  const parts = result.map((part) => {
    if (part.type === "image") return part
    const start = state.cursor
    state.cursor += part.content.length
    return { ...part, start, end: state.cursor }
  })
  // The caller advances the captured cursor for ordered multi-file insertion.
  return { parts, cursor: state.next }
}
