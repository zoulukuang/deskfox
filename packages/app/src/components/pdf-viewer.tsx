// [fork-only] PDF 查看器(pdf.js 渲染到 canvas)
//
// 背景:上游 electron 版前端**没有任何 PDF 渲染**(pdfjs 只在 feishu 后端用),file-media.tsx 无 pdf 分支 →
// 原生 .pdf 落到文本/兜底渲染(显示原始字节),Office 转出的 PDF 也无处渲染 → 预览全空白(冒烟扫出)。
// 本组件补回 PDF 渲染:接 url(localasset:// 原生 pdf)或 bytes(Office 经 LibreOffice 转换的字节),
// 用 pdf.js 把每页画到 canvas。worker 经 vite `?url` 打成同源 oc:// 资源,无需 worker(没 CSP 限制,实测无违规)。
// 文本选区层(textLayer,选 PDF 文字加聊天)留作后续增强,先把"能渲染"修好。
// [feat: pdf-render-path] 2026-06-13

import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
// @ts-ignore vite ?url:把 worker 打成同源资源,返回其 URL(oc://renderer/assets/...)
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

if (!GlobalWorkerOptions.workerSrc) {
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl as unknown as string
}

const MAX_PAGES = 300 // 兜底:超大 PDF 不无限渲染

export function PdfViewer(props: {
  /** localasset:// 等可直接 fetch 的 PDF URL(原生 pdf 走这条) */
  url?: string
  /** 已在内存的 PDF 字节(Office 转换结果走这条) */
  bytes?: Uint8Array
  /** 懒加载字节(如 Office 调 loadOfficePdf);有它时优先于 url */
  loadBytes?: () => Promise<Uint8Array | undefined>
}): JSX.Element {
  let container: HTMLDivElement | undefined
  const [status, setStatus] = createSignal<"loading" | "ready" | "empty" | "error">("loading")
  const [errMsg, setErrMsg] = createSignal("")

  createEffect(() => {
    // 依赖:url / bytes / loadBytes 任一变化都重渲染
    const url = props.url
    const bytes = props.bytes
    const loadBytes = props.loadBytes
    let cancelled = false
    let pdfDoc: any

    const run = async () => {
      setStatus("loading")
      setErrMsg("")
      if (container) container.innerHTML = ""
      try {
        let source: any
        if (loadBytes) {
          const b = await loadBytes()
          if (cancelled) return
          if (!b || b.length === 0) {
            setStatus("empty")
            return
          }
          source = { data: b }
        } else if (bytes && bytes.length > 0) {
          source = { data: bytes }
        } else if (url) {
          source = { url }
        } else {
          setStatus("empty")
          return
        }

        pdfDoc = await getDocument(source).promise
        if (cancelled) {
          pdfDoc?.destroy?.()
          return
        }
        const total = Math.min(pdfDoc.numPages, MAX_PAGES)
        const dpr = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2)
        const cw = container?.clientWidth || 800

        for (let n = 1; n <= total; n++) {
          if (cancelled) break
          const page = await pdfDoc.getPage(n)
          if (cancelled) break
          const base = page.getViewport({ scale: 1 })
          const scale = Math.max(0.2, (cw - 24) / base.width) // 适配容器宽,留点边距
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement("canvas")
          canvas.className = "pdf-page-wrapper"
          canvas.style.display = "block"
          canvas.style.margin = "0 auto 12px"
          canvas.style.width = Math.floor(viewport.width) + "px"
          canvas.style.height = Math.floor(viewport.height) + "px"
          canvas.style.boxShadow = "0 1px 4px rgba(0,0,0,0.18)"
          canvas.width = Math.floor(viewport.width * dpr)
          canvas.height = Math.floor(viewport.height * dpr)
          const ctx = canvas.getContext("2d")
          if (!ctx) continue
          container?.appendChild(canvas)
          await page.render({
            canvasContext: ctx,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise
        }
        if (!cancelled) setStatus(total > 0 ? "ready" : "empty")
      } catch (e) {
        if (!cancelled) {
          console.warn("[PdfViewer] render failed", e)
          setStatus("error")
          setErrMsg(String((e as any)?.message ?? e))
        }
      }
    }
    void run()

    onCleanup(() => {
      cancelled = true
      try {
        pdfDoc?.destroy?.()
      } catch {}
    })
  })

  return (
    <div class="relative h-full w-full overflow-auto bg-background-stronger" data-slot="pdf-canvas-scroll">
      <Show when={status() === "loading"}>
        <div class="absolute inset-0 flex items-center justify-center text-text-weak text-sm">加载中…</div>
      </Show>
      <Show when={status() === "empty"}>
        <div class="absolute inset-0 flex items-center justify-center text-text-weak text-sm px-6 text-center">
          无法生成预览(可能转换失败或为空),请用上方"用本机软件打开"。
        </div>
      </Show>
      <Show when={status() === "error"}>
        <div class="absolute inset-0 flex items-center justify-center text-text-weak text-sm px-6 text-center">
          预览出错:{errMsg()}
        </div>
      </Show>
      <div ref={container} class="py-3" />
    </div>
  )
}
