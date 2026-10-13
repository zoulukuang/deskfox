// Fork-only: shared legacy Read/inline attachment limits. No services or browser dependencies.
export const TEXT_MAX_BYTES = 50 * 1024
export const TEXT_MAX_LINES = 2000
export const TEXT_MAX_LINE_LENGTH = 2000
const suffix =
  "\n\n(Attachment truncated. Content may also be omitted within a line. Ask for a smaller excerpt or a readable file reference; no local file path has been verified.)"
const encoder = new TextEncoder()

export function limitReadLine(text: string) {
  if (text.length <= TEXT_MAX_LINE_LENGTH) return text
  const end = /[\uD800-\uDBFF]/.test(text[TEXT_MAX_LINE_LENGTH - 1]) ? TEXT_MAX_LINE_LENGTH - 1 : TEXT_MAX_LINE_LENGTH
  return text.slice(0, end) + `... (line truncated to ${TEXT_MAX_LINE_LENGTH} chars)`
}

export function attachmentText(text: string) {
  const lines = text.split(/\r\n|\n|\r/)
  if (lines.at(-1) === "") lines.pop()
  if (
    encoder.encode(text).length <= TEXT_MAX_BYTES &&
    lines.length <= TEXT_MAX_LINES &&
    lines.every((line) => line.length <= TEXT_MAX_LINE_LENGTH)
  )
    return text
  const state = { bytes: encoder.encode(suffix).length, lines: [] as string[] }
  for (const source of lines.slice(0, TEXT_MAX_LINES)) {
    const line = limitReadLine(source)
    const bytes = encoder.encode(line).length + (state.lines.length ? 1 : 0)
    if (state.bytes + bytes > TEXT_MAX_BYTES) break
    state.lines.push(line)
    state.bytes += bytes
  }
  return state.lines.join("\n") + suffix
}

export function decodeAttachmentText(url: string) {
  const comma = url.indexOf(",")
  if (comma < 0) throw new Error("Invalid text attachment: missing data URL body")
  const body = url.slice(comma + 1)
  if (!url.slice(0, comma).includes(";base64")) return decodeURIComponent(body)
  // Buffer.from silently drops invalid base64 characters. Reject corrupted attachments instead.
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?)?$/.test(body))
    throw new Error("Invalid text attachment: malformed base64")
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(body), (char) => char.charCodeAt(0)))
}
