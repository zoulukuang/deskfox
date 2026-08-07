import { marked } from "marked"
import { codeToHtml } from "shiki"
import markedShiki from "marked-shiki"
import { createOverflow, useShareMessages } from "./common"
// FORK: REQ-098 收紧 del 定界符(只认 ~~)[feat: chat-tilde-del-fix] 2026-08-07
import { strictDelExtension } from "./marked-del-strict"
import { CopyButton } from "./copy-button"
import { createResource, createSignal } from "solid-js"
import style from "./content-markdown.module.css"

const markedWithShiki = marked.use(
  // FORK: REQ-098 单波浪号误判删除线 —— 与桌面聊天页(packages/ui/src/context/marked.tsx)同病同治。
  // marked.use() 作用于各自模块实例,ui 那次改动不会传导到这里,必须各加一次。2026-08-07
  strictDelExtension,
  {
    renderer: {
      link({ href, title, text }) {
        const titleAttr = title ? ` title="${title}"` : ""
        return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
      },
    },
  },
  markedShiki({
    highlight(code, lang) {
      return codeToHtml(code, {
        lang: lang || "text",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })
    },
  }),
)

interface Props {
  text: string
  expand?: boolean
  highlight?: boolean
}
export function ContentMarkdown(props: Props) {
  const [html] = createResource(
    () => strip(props.text),
    async (markdown) => {
      return markedWithShiki.parse(markdown)
    },
  )
  const [expanded, setExpanded] = createSignal(false)
  const overflow = createOverflow()
  const messages = useShareMessages()

  return (
    <div
      class={style.root}
      data-highlight={props.highlight === true ? true : undefined}
      data-expanded={expanded() || props.expand === true ? true : undefined}
    >
      <div data-slot="markdown" ref={overflow.ref} innerHTML={html()} />

      {!props.expand && overflow.status && (
        <button
          type="button"
          data-component="text-button"
          data-slot="expand-button"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded() ? messages.show_less : messages.show_more}
        </button>
      )}
      <CopyButton text={props.text} />
    </div>
  )
}

function strip(text: string): string {
  const wrappedRe = /^\s*<([A-Za-z]\w*)>\s*([\s\S]*?)\s*<\/\1>\s*$/
  const match = text.match(wrappedRe)
  return match ? match[2] : text
}
