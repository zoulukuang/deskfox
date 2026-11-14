// FORK-ONLY: file delivery contract across model transports [feat: daily-file-links] 2026-11-14
import type { ModelMessage } from "ai"

export const FILE_DELIVERY = `[DeskFox file links]
When referring to a specific file you have located or created, provide a clickable Markdown link: [filename](absolute-path). Each link target must contain the complete absolute path of that exact file, as observed in the tool result or other explicit file evidence. Never shorten, truncate or replace any directory with "...", "…", a placeholder, an environment variable or a guessed prefix, even for long paths. Only the visible link label may be shortened; the target must remain complete. Check every file link against its known full path before replying. Encode spaces, Unicode and literal percent signs in each path segment, retaining / separators and Windows drive letters. Examples: [report.pdf](/Users/name/Downloads/report%20draft.pdf), [guide.md](C:/work/docs/guide.md). Do not use file:// URLs. Preserve explicit user output-format requirements, web links and code examples. If the exact path is unknown or ambiguous, say so instead of inventing or abbreviating a link.
Treat tool-reported file names as literal filesystem text. Encode each segment once. For a literal filename report%20draft.md, the target segment is report%2520draft.md. For report draft.md, it is report%20draft.md. Preserve the exact spacing: %20 means a space only when it encodes a space actually present in the source path. Before emitting the link, verify that decoding the target once reproduces the tool path exactly.
[/DeskFox file links]`

export function fileDeliveryEnabled(input: {
  small?: boolean
  agent: { name: string }
  user: { format?: { type: string } }
}) {
  return !input.small && input.agent.name !== "compaction" && input.user.format?.type !== "json_schema"
}

// Some provider bridges discard system messages. Add the same convention to a
// request-only copy of the final user message without mutating durable history.
export function withFileDelivery(messages: ModelMessage[], small?: boolean): ModelMessage[] {
  if (small) return messages
  const index = messages.findLastIndex((message) => message.role === "user")
  const message = messages[index]
  if (!message || message.role !== "user") return messages
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
  if (text.includes(FILE_DELIVERY)) return messages
  const content =
    typeof message.content === "string"
      ? `${message.content}\n\n${FILE_DELIVERY}`
      : [...message.content, { type: "text" as const, text: FILE_DELIVERY }]
  return messages.map((item, position) => (position === index ? { ...message, content } : item))
}
