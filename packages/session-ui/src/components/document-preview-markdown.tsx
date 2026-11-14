// FORK-ONLY: no automatically loaded resources in external document preview [feat: daily-file-links] 2026-11-14
import { createResource } from "solid-js"
import DOMPurify from "dompurify"
import { useMarked } from "@opencode-ai/ui/context/marked"

export function sanitizeDocumentMarkdown(html: string) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "div",
      "span",
      "br",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "pre",
      "code",
      "strong",
      "em",
      "b",
      "i",
      "s",
      "del",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "sup",
      "sub",
      "details",
      "summary",
    ],
    ALLOWED_ATTR: ["href", "id", "title"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    SANITIZE_NAMED_PROPS: true,
    // Keep ordinary links and Windows absolute paths; never allow executable or resource schemes.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/|\.{1,2}\/|[a-zA-Z]:[\\/]|[^:/?#]+(?:[/?#]|$))/i,
  })
}

export function DocumentPreviewMarkdown(props: { text: string }) {
  const marked = useMarked()
  const [html] = createResource(
    () => props.text,
    async (text) => sanitizeDocumentMarkdown(await marked.parse(text)),
  )
  return <div data-component="markdown" innerHTML={html() ?? ""} />
}
