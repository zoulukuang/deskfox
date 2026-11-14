// FORK-ONLY: exact-file, read-only artifact preview [feat: daily-file-links] 2026-11-14
import { constants } from "node:fs"
import { open, realpath, stat } from "node:fs/promises"
import path from "node:path"

const textTypes = new Set(
  "txt json csv tsv yaml yml toml xml log ini css js jsx ts tsx py rb rs go java c h cpp sh sql html htm svg".split(
    " ",
  ),
)
const officeTypes = new Set("doc docx xls xlsx ppt pptx rtf odt ods odp".split(" "))
const TEXT_LIMIT = 2 * 1024 * 1024
const DOCUMENT_LIMIT = 50 * 1024 * 1024

// Mirror the renderer contract in app/src/utils/document-preview.ts.
export type DocumentPreview =
  | { ok: true; path: string; kind: "text" | "markdown" | "pdf" | "office"; content: string }
  | {
      ok: false
      reason:
        | "invalid"
        | "missing"
        | "permission"
        | "unreachable"
        | "directory"
        | "unsupported"
        | "too-large"
        | "encoding"
        | "read"
    }

export async function readDocumentPreview(input: { path: string }): Promise<DocumentPreview> {
  if (typeof input.path !== "string" || !path.isAbsolute(input.path) || input.path.includes("\0")) {
    return { ok: false, reason: "invalid" }
  }
  try {
    const canonical = await realpath(input.path)
    if (!(await stat(canonical)).isFile()) return { ok: false, reason: "directory" }
    // Recheck the opened handle too; nonblocking open avoids hanging if a file
    // is replaced by a FIFO between stat and open on POSIX.
    const handle = await open(canonical, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) return { ok: false, reason: "directory" }
      const ext = path.extname(canonical).slice(1).toLowerCase()
      const kind =
        ext === "pdf"
          ? "pdf"
          : officeTypes.has(ext)
            ? "office"
            : ext === "md" || ext === "markdown"
              ? "markdown"
              : textTypes.has(ext) || !ext
                ? "text"
                : undefined
      if (!kind) return { ok: false, reason: "unsupported" }
      const limit = kind === "pdf" || kind === "office" ? DOCUMENT_LIMIT : TEXT_LIMIT
      if (stat.size > limit) return { ok: false, reason: "too-large" }
      // Office conversion uses the existing sidecar endpoint, after exact-file validation.
      if (kind === "office") return { ok: true, path: canonical, kind, content: "" }
      const bytes = Buffer.alloc(stat.size)
      let offset = 0
      while (offset < bytes.length) {
        const next = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!next.bytesRead) break
        offset += next.bytesRead
      }
      const content = bytes.subarray(0, offset)
      if (kind === "pdf") return { ok: true, path: canonical, kind, content: content.toString("base64") }
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(content)
        if (text.includes("\0")) return { ok: false, reason: "encoding" }
        return { ok: true, path: canonical, kind, content: text }
      } catch {
        return { ok: false, reason: "encoding" }
      }
    } finally {
      await handle.close()
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined
    const reason =
      code === "ENOENT" || code === "ENOTDIR"
        ? "missing"
        : code === "EACCES" || code === "EPERM"
          ? "permission"
          : code === "ENODEV" || code === "ENXIO" || code === "EIO"
            ? "unreachable"
            : "read"
    return { ok: false, reason }
  }
}
