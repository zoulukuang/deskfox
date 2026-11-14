// FORK-ONLY: preserve exact Windows file hrefs without widening other URI schemes [feat: daily-file-links] 2026-11-14
import type { UponSanitizeAttributeHook } from "dompurify"

export const preserveWindowsFileLink: UponSanitizeAttributeHook = (node, attribute) => {
  if (node.tagName !== "A" || attribute.attrName !== "href") return
  if (/^[a-zA-Z]:[\\/]/.test(attribute.attrValue)) attribute.forceKeepAttr = true
}
