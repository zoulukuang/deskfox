import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { getFilenameTruncated } from "@opencode-ai/core/util/path"
import { isChatSelectionPath } from "@opencode-ai/core/util/chat-selection"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { AttachmentCardV2 } from "./attachment-card-v2"

export function CommentCardV2(props: {
  comment: string
  path: string
  selection?: { startLine: number; endLine: number }
  active?: boolean
  title?: string
  tooltip?: boolean
  wide?: boolean
  onClick?: () => void
  // FORK-BEGIN: REQ-131 [feat: release-closeout-2026-09] 2026-09-17
  /** 引文原文。有它就说明这张卡能回看,tooltip 常开 */
  preview?: string
  /** chat = 引用本次对话的一段话,没有真实文件可显示 */
  kind?: "chat" | "file"
  // FORK-END
}) {
  let title: HTMLSpanElement | undefined
  const [truncated, setTruncated] = createSignal(false)

  // FORK: REQ-131 —— 聊天引用的副标题:引文首行。空引文(老消息无 metadata)回退到通用词,
  //   绝不回落成打印伪路径。 [feat: release-closeout-2026-09] 2026-09-17
  const quoteLabel = () => {
    const first = props.preview?.split("\n").find((line) => line.trim().length > 0)?.trim()
    if (!first) return "引用对话"
    return first.length > 24 ? `${first.slice(0, 24)}…` : first
  }

  onMount(() => {
    const element = title
    if (!element) return
    const sync = () => setTruncated(element.scrollWidth > element.clientWidth)
    const measure = () => requestAnimationFrame(sync)
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    measure()
    void document.fonts?.ready.then(measure)
    onCleanup(() => observer.disconnect())
  })

  return (
    <TooltipV2
      placement="top"
      openDelay={1000}
      value={props.title ?? props.comment}
      // FORK: REQ-131 —— 原先只有标题被截断才给 tooltip,而截断量的是**注释**那一行;
      //   注释很短、引文很长时就永远没 tooltip,回看无门。有引文一律放行。
      //   [feat: release-closeout-2026-09] 2026-09-17
      disabled={!props.tooltip || (!truncated() && !props.preview)}
      class={props.wide ? "w-full" : undefined}
      contentStyle={{ "max-width": "320px", "white-space": "pre-wrap" }}
    >
      <AttachmentCardV2
        title={props.comment}
        active={props.active}
        clickable={!!props.onClick}
        wide={props.wide}
        surface="base"
        titleRef={(element) => {
          title = element
        }}
        onClick={props.onClick}
      >
        {/* FORK-BEGIN: REQ-131 副标题按 kind 分流 [feat: release-closeout-2026-09] 2026-09-17
            聊天引用的 path 是固定伪路径 "<chat selection>"(core/util/chat-selection.ts),
            原先无条件走 getFilenameTruncated 把它当文件名印出来,于是卡片上赫然写着
            "<chat selection>" —— 既没信息量又像个 bug。dom-provider 里"卡片渲染也不显示"
            那句注释早就失效了。
            改成:聊天引用显引文首行(它才真正说明"引的是哪段"),文件引用维持 文件名:行范围。 */}
        <Show
          when={props.kind === "chat" || isChatSelectionPath(props.path)}
          fallback={
            <>
              <FileIcon node={{ path: props.path, type: "file" }} />
              <span>
                {getFilenameTruncated(props.path, 14)}
                <Show when={props.selection}>
                  {(sel) =>
                    sel().startLine === sel().endLine
                      ? `:${sel().startLine}`
                      : `:${sel().startLine}-${sel().endLine}`
                  }
                </Show>
              </span>
            </>
          }
        >
          <span data-slot="comment-card-v2-quote">{quoteLabel()}</span>
        </Show>
        {/* FORK-END */}
      </AttachmentCardV2>
    </TooltipV2>
  )
}
