import { onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { showToast } from "@/utils/toast"
import { type ContentPart, type ImageAttachmentPart, type usePrompt } from "@/context/prompt"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
// FORK: REQ-026 粘贴/拖图前查当前模型 image 能力 [feat: model-capability-ui] 2026-08-02
import { useLocal } from "@/context/local"
import { modelSupportsImage } from "../model-capability"
import { usePlatform } from "@/context/platform"
import { uuid } from "@/utils/uuid"
import { getCursorPosition } from "./editor-dom"
import { createBlobReference, type DraftStore } from "@/utils/draft-store"
import { attachmentMime } from "./files"
// FORK: 多选拖动 abs→rel 转换 helper(无 context 依赖,可单测) 2026-05-15
import { parseMultiPathDropPaths, toMentionPath } from "./multi-path-drop"
// FORK: 外部拖入路由(非图片走路径引用)[feat: external-drop-path-ref] 2026-08-14
import { rejectionToastKind, routeExternalDrop, shouldBlockAsImage } from "./external-drop"
// FORK: shared routing for picker, paste and drop [feat: attachment-cost-guard] 2026-10-12
import { useServerSDK } from "@/context/server-sdk"
import { ServerConnection } from "@/context/server"
import { insertAttachmentReference } from "./attachment-reference"
import { normalizePaste, pasteMode } from "./paste"

type PromptTarget = Pick<ReturnType<ReturnType<typeof usePrompt>["capture"]>, "current" | "cursor" | "set">
type AttachmentTarget = { prompt: PromptTarget; cursor: number | undefined; directory?: string; local?: boolean }

type PromptAttachmentsCoreInput = {
  capture: () => PromptTarget
  editor: () => HTMLDivElement | undefined
  focusEditor?: () => void
  addPart?: (part: ContentPart) => boolean
  warn?: () => void
  // FORK: REQ-026 模型不支持图片发送前拦截(可选注入,wrapper 提供实现)[feat: model-capability-ui] 2026-08-02
  isImageBlocked?: () => boolean
  warnImageUnsupported?: () => void
  readClipboardImage?: () => Promise<File | null>
  getPathForFile?: (file: File) => string
  draftStore?: DraftStore
  referenceDirectory?: () => string | undefined
}

export type PromptAttachmentsInput = {
  prompt: ReturnType<typeof usePrompt>
  editor: () => HTMLDivElement | undefined
  isDialogActive: () => boolean
  setDraggingType: (type: "image" | "@mention" | null) => void
  focusEditor: () => void
  addPart: (part: ContentPart) => boolean
  readClipboardImage?: () => Promise<File | null>
  getPathForFile?: (file: File) => string
}

export function createPromptAttachmentsCore(input: PromptAttachmentsCoreInput) {
  const capture = (): AttachmentTarget | undefined => {
    const prompt = input.capture()
    const editor = input.editor()
    if (!editor) return
    const selection = editor.ownerDocument.getSelection()
    return {
      prompt,
      // FORK: arrow/mouse caret moves do not update the persisted draft cursor 2026-10-12
      cursor: selection?.rangeCount && editor.contains(selection.anchorNode) ? getCursorPosition(editor) : prompt.cursor(),
      directory: input.referenceDirectory?.(),
      local: input.referenceDirectory?.() !== undefined,
    }
  }

  const add = async (file: File, toast = true, target = capture()) => {
    if (!target) return false
    const mime = await attachmentMime(file)
    if (!mime) {
      if (toast) input.warn?.()
      return false
    }
    // FORK: REQ-026 当前模型明确不支持图片 → 拦截 + toast(2026-08-11 移植到 Core 注入式)[feat: model-capability-ui]
    //   [bug-repro: 这里原先**对所有附件生效**,不只图片 —— 模型不支持图片时,连 .txt/.csv
    //    也会被这条拦掉并弹「模型不支持图片」。此前被 attachmentMime 白名单掩盖着不易察觉;
    //    档一放开类型后会立刻暴露。判据加 `mime.startsWith("image/")`。
    //    [feat: external-drop-path-ref] 2026-08-14]
    if (shouldBlockAsImage(mime, input.isImageBlocked?.() ?? false)) {
      if (toast) input.warnImageUnsupported?.()
      return false
    }

    // FORK-BEGIN: route only normalized text with verified shared filesystem before creating a blob.
    const route = routeExternalDrop({ type: mime, path: input.getPathForFile?.(file), local: target.local })
    if (route.kind === "path") {
      const next = insertAttachmentReference(
        target.prompt.current(),
        toMentionPath(route.path, target.directory),
        target.cursor,
      )
      target.prompt.set(next.parts, next.cursor)
      target.cursor = next.cursor
      return true
    }
    // FORK-END
    const attachment: ImageAttachmentPart = {
      type: "image",
      id: uuid(),
      filename: file.name,
      sourcePath: input.getPathForFile?.(file) || undefined,
      mime,
      blob: input.draftStore ? await input.draftStore.putBlob(file) : await createBlobReference(file),
    }
    target.prompt.set([...target.prompt.current(), attachment], target.cursor)
    return true
  }

  const addAttachment = (file: File) => add(file)

  const addAttachments = async (files: File[], toast = true, target = capture()) => {
    let found = false
    const rejected: File[] = [] // FORK: partial success must still report rejected files

    for (const file of files) {
      const ok = await add(file, false, target)
      if (ok) found = true
      if (!ok) rejected.push(file)
    }

    // FORK: REQ-026 多文件全被拦时分流提示:模型不支持图片给专属 toast,其余保持原「不支持的粘贴」
    //   [bug-repro: 与上面 `add()` 里同一个毛病 —— 这里也不看文件是不是图片就弹
    //    「模型不支持图片」。一批全是 .txt 被拒时,用户会看到一句莫名其妙的图片提示。
    //    加 `files.some(isImageDrop)` 限定。[feat: external-drop-path-ref] 2026-08-14]
    if (rejected.length > 0 && toast) {
      if (rejectionToastKind(rejected, input.isImageBlocked?.() ?? false) === "image-unsupported")
        input.warnImageUnsupported?.()
      else input.warn?.()
    }
    return found
  }

  const addClipboardAttachment = async (pending: Promise<File | null>, target = capture()) => {
    const file = await pending
    if (!file) return false
    return add(file, true, target)
  }

  const removeAttachment = (id: string) => {
    const target = input.capture()
    const current = target.current()
    const next = current.filter((part) => part.type !== "image" || part.id !== id)
    target.set(next, target.cursor())
  }

  const handlePaste = async (event: ClipboardEvent) => {
    const clipboardData = event.clipboardData
    if (!clipboardData) return
    const target = capture()
    if (!target) return

    event.preventDefault()
    event.stopPropagation()

    const files = Array.from(clipboardData.items).flatMap((item) => {
      if (item.kind !== "file") return []
      const file = item.getAsFile()
      return file ? [file] : []
    })

    if (files.length > 0) {
      await addAttachments(files, true, target)
      return
    }

    const plainText = clipboardData.getData("text/plain") ?? ""

    // Desktop: Browser clipboard has no images and no text, try platform's native clipboard for images
    if (input.readClipboardImage && !plainText) {
      if (await addClipboardAttachment(input.readClipboardImage(), target)) return
    }

    if (!plainText) return

    const text = normalizePaste(plainText)

    const put = () => {
      if (input.addPart?.({ type: "text", content: text, start: 0, end: 0 })) return true
      input.focusEditor?.()
      return input.addPart?.({ type: "text", content: text, start: 0, end: 0 }) ?? false
    }

    if (pasteMode(text) === "manual") {
      put()
      return
    }

    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, text)
    if (inserted) return

    put()
  }

  return {
    captureAttachment: () => {
      const target = capture()
      return (file: File) => add(file, true, target)
    }, // FORK: native picker ownership
    addAttachment,
    addAttachments,
    addClipboardAttachment,
    removeAttachment,
    handlePaste,
  }
}

export function createPromptAttachments(input: PromptAttachmentsInput) {
  const language = useLanguage()
  // FORK: REQ-026 [feat: model-capability-ui] 2026-08-02 — 注入模型图片能力拦截实现
  const local = useLocal()
  // FORK: 多选拖动 abs→rel 需要项目根 [feat: file-tree-multi-drag-to-chat] 2026-05-15
  const sdk = useSDK()
  const platform = usePlatform()
  const serverSDK = useServerSDK() // FORK: use this tab connection, not the globally selected server
  const attachments = createPromptAttachmentsCore({
    ...input,
    draftStore: platform.draftStore,
    referenceDirectory: () =>
      platform.platform === "desktop" && ServerConnection.builtin(serverSDK().server) ? sdk().directory : undefined,
    capture: input.prompt.capture,
    warn: () => {
      showToast({
        title: language.t("prompt.toast.pasteUnsupported.title"),
        description: language.t("prompt.toast.pasteUnsupported.description"),
      })
    },
    // FORK-BEGIN: REQ-026 模型不支持图片 → 发送前拦截。仅当能力**明确为 false** 才拦
    // (能力未知保守放行,后端 ERROR 文本仍是兜底);「先贴图后换模型」路径不在此拦(spec 记录)。
    isImageBlocked: () => modelSupportsImage(local.model.current()) === false,
    warnImageUnsupported: () => {
      showToast({
        title: language.t("prompt.toast.imageUnsupported.title"),
        description: language.t("prompt.toast.imageUnsupported.description", {
          model: local.model.current()?.name ?? "",
        }),
      })
    },
    // FORK-END
  })

  const handleGlobalDragOver = (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    const hasFiles = event.dataTransfer?.types.includes("Files")
    const hasText = event.dataTransfer?.types.includes("text/plain")
    // FORK: 多选拖动从 file-tree 来时 types 含 `application/x-deskfox-paths` 而非 text/plain
    // (file-tree-dnd 的多源拖动协议)— 把它也当 @mention 提示 2026-05-15
    const hasMultiPath = event.dataTransfer?.types.includes("application/x-deskfox-paths")
    if (hasFiles) {
      input.setDraggingType("image")
    } else if (hasText || hasMultiPath) {
      input.setDraggingType("@mention")
    }
  }

  const handleGlobalDragLeave = (event: DragEvent) => {
    if (input.isDialogActive()) return
    if (!event.relatedTarget) {
      input.setDraggingType(null)
    }
  }

  // FORK: drop overlay 卡死兜底 — file-tree 行 onDrop 调 stopPropagation 杀掉 document bubble drop,
  //   overlay 状态没人复位会卡死;window capture 阶段 + dragend 双保险复位。
  //   [feat: chat-drop-overlay-stuck-fix] 2026-05-21
  const handleDragOverlayReset = () => {
    input.setDraggingType(null)
  }

  const handleGlobalDrop = async (event: DragEvent) => {
    if (input.isDialogActive()) return

    event.preventDefault()
    input.setDraggingType(null)

    // FORK: 多选拖动优先级最高 — file-tree 多选时只写 `application/x-deskfox-paths`(无 text/plain)
    // 单选时走下面 text/plain 路径(原行为)。 2026-05-15
    const multiJson = event.dataTransfer?.getData("application/x-deskfox-paths")
    if (multiJson) {
      const paths = parseMultiPathDropPaths(multiJson, sdk().directory)
      if (paths.length > 0) {
        input.focusEditor()
        for (const p of paths) {
          input.addPart({ type: "file", path: p, content: "@" + p, start: 0, end: 0 })
        }
        return
      }
    }

    const plainText = event.dataTransfer?.getData("text/plain")
    const filePrefix = "file:"
    if (plainText?.startsWith(filePrefix)) {
      const filePath = plainText.slice(filePrefix.length)
      input.focusEditor()
      input.addPart({ type: "file", path: filePath, content: "@" + filePath, start: 0, end: 0 })
      return
    }

    const dropped = event.dataTransfer?.files
    if (!dropped) return

    // FORK: all external files use the same captured-draft admission path.
    await attachments.addAttachments(Array.from(dropped))
  }

  onMount(() => {
    makeEventListener(document, "dragover", handleGlobalDragOver)
    makeEventListener(document, "dragleave", handleGlobalDragLeave)
    makeEventListener(document, "drop", handleGlobalDrop)
    // FORK: 见 handleDragOverlayReset 上方注释 [feat: chat-drop-overlay-stuck-fix] 2026-05-21
    makeEventListener(window, "drop", handleDragOverlayReset, { capture: true })
    makeEventListener(window, "dragend", handleDragOverlayReset)
  })

  return attachments
}
