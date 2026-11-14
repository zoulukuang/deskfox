// FORK-ONLY: local sidecar provenance and exact-file preview wiring [feat: daily-file-links] 2026-11-14
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useSDK } from "@/context/sdk"
import { ServerConnection } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { onCleanup } from "solid-js"
import { createDocumentPreviewOpener, type DocumentPreview } from "@/utils/document-preview"
import { invoke, isDesktopApp } from "@/utils/native"
import { DialogDocumentPreview } from "@/components/dialog-document-preview"

export function createDocumentLinkOpener() {
  const dialog = useDialog()
  const server = useServerSDK()
  const sdk = useSDK()
  let live = true
  onCleanup(() => {
    live = false
  })
  const source = () => {
    const current = server()
    if (!live || !isDesktopApp() || !ServerConnection.builtin(current.server) || sdk().scope !== current.scope) return
    return JSON.stringify([current.scope, current.url, sdk().directory])
  }
  const open = createDocumentPreviewOpener({
    source,
    read: (path) => invoke<DocumentPreview>("read_document_preview", { path }),
    show: (document, fragment) => {
      const connection = source()
      const project = sdk().directory
      const client = sdk().client
      dialog.show(() => (
        <DialogDocumentPreview
          document={document}
          fragment={fragment}
          project={project}
          open={open}
          office={async (path) => {
            if (!connection || source() !== connection) throw new Error("连接已切换，请重新打开文档")
            const result = await client.file.officePdf({ path }, { parseAs: "arrayBuffer" }).catch(() => {
              throw new Error("文档转换失败，请确认 Office 预览组件已就绪")
            })
            if (source() !== connection) throw new Error("连接已切换，请重新打开文档")
            const data: unknown = result.data
            if (data instanceof ArrayBuffer) return new Uint8Array(data)
            if (data instanceof Uint8Array) return data
            throw new Error("文档转换失败，请确认 Office 预览组件已就绪")
          }}
        />
      ))
    },
  })
  return open
}
