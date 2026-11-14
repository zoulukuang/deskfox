// FORK-ONLY: read-only preview of one explicitly clicked file [feat: daily-file-links] 2026-11-14
import { createEffect, createResource, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DocumentViewer } from "@opencode-ai/ui/document-viewer"
import { DocumentPreviewMarkdown } from "@opencode-ai/session-ui/document-preview-markdown"
import { createMdLinkClickHandler } from "@/pages/session/md-link-click"
import { scrollMdFragment } from "@/pages/session/md-fragment"
import { documentBytes, type DocumentPreview } from "@/utils/document-preview"
import { resolveAbsolute } from "@/utils/local-asset"
import { showToast } from "@/utils/toast"

export function DialogDocumentPreview(props: {
  document: Extract<DocumentPreview, { ok: true }>
  fragment: string
  project: string
  open: (path: string, fragment: string) => Promise<void>
  office: (path: string) => Promise<Uint8Array>
}) {
  const [container, setContainer] = createSignal<HTMLDivElement>()
  const [pdfError, setPdfError] = createSignal(false)
  const [pdf] = createResource(async () => {
    if (props.document.kind === "pdf") return documentBytes(props.document.content)
    if (props.document.kind !== "office") return undefined
    const bytes = await props.office(props.document.path)
    if (!bytes.length) throw new Error("文档转换失败，请确认 Office 预览组件已就绪")
    if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("转换后的 PDF 超过预览大小限制")
    return bytes
  })
  const base = () => props.document.path.replace(/\\/g, "/").replace(/\/[^/]*$/, "")
  const click = createMdLinkClickHandler({
    root: () => props.project,
    baseDir: base,
    queueFragment: false,
    onOpen: (rel, fragment) => {
      void props.open(resolveAbsolute(props.project, rel), fragment ?? "").catch(error)
    },
    onOpenOutside: props.open,
    checkExists: async () => {}, // The exact-file reader checks existence on each explicit click.
    toast: showToast,
  })
  const error = (cause: unknown) =>
    showToast({
      variant: "error",
      title: "无法打开文件",
      description: cause instanceof Error ? cause.message : String(cause),
    })
  createEffect(() => {
    const scope = container()
    if (!scope || !props.fragment) return
    const observer = new MutationObserver(() => {
      if (scrollMdFragment(scope, props.fragment)) observer.disconnect()
    })
    observer.observe(scope, { childList: true, subtree: true })
    if (scrollMdFragment(scope, props.fragment)) observer.disconnect()
    onCleanup(() => observer.disconnect())
  })
  return (
    <Dialog
      title={props.document.path.replace(/\\/g, "/").split("/").at(-1)}
      description={props.document.path}
      size="x-large"
    >
      <div
        data-component="document-preview"
        class="h-[70vh] overflow-auto px-6 py-4 select-text"
        ref={setContainer}
        onClick={click}
      >
        <Switch>
          <Match when={props.document.kind === "markdown"}>
            <DocumentPreviewMarkdown text={props.document.content} />
          </Match>
          <Match when={props.document.kind === "text"}>
            <pre class="whitespace-pre-wrap break-words">{props.document.content}</pre>
          </Match>
          <Match when={props.document.kind === "pdf" || props.document.kind === "office"}>
            <Show when={!pdf.loading} fallback={<p>正在加载文档…</p>}>
              <Show
                when={!pdf.error && !pdfError()}
                fallback={<p role="alert">{pdf.error instanceof Error ? pdf.error.message : "无法预览此 PDF 文档"}</p>}
              >
                <Show when={pdf()}>
                  {(bytes) => (
                    <DocumentViewer
                      kind="pdf"
                      value={{ bytes: bytes() }}
                      onError={() => setPdfError(true)}
                      fallback={() => <p>无法预览此 PDF 文档</p>}
                    />
                  )}
                </Show>
              </Show>
            </Show>
          </Match>
        </Switch>
      </div>
    </Dialog>
  )
}
