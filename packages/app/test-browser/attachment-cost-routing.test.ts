import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createPromptState } from "@/context/prompt"
import { createPromptAttachmentsCore } from "@/components/prompt-input/attachments"
import { insertAttachmentReference } from "@/components/prompt-input/attachment-reference"
import { attachmentMime } from "@/components/prompt-input/files"
import { createPromptInputV2Attachments } from "../../session-ui/src/v2/components/prompt-input/attachments"

test("classic mixed admission preserves order and captured draft, never allocates blobs for references", async () => {
  await createRoot(async (dispose) => {
    const a = createPromptState()
    const b = createPromptState()
    let active = a
    const attach = createPromptAttachmentsCore({
      capture: () => active.capture(),
      editor: () => document.createElement("div"),
      referenceDirectory: () => "/tmp",
      getPathForFile: (file) => `/tmp/${file.name}`,
    })
    const pending = attach.addAttachments([
      new File(["hello"], "a.txt"),
      new File(["%PDF"], "b.pdf", { type: "application/pdf" }),
      new File(["hello"], "c.csv"),
    ])
    active = b
    await pending
    expect(
      a
        .current()
        .filter((part) => part.type === "file")
        .map((part) => part.path),
    ).toEqual(["a.txt", "c.csv"])
    expect(
      a
        .current()
        .filter((part) => part.type === "image")
        .map((part) => part.filename),
    ).toEqual(["b.pdf"])
    expect(b.current().every((part) => part.type === "text" && part.content === "")).toBe(true)
    dispose()
  })
})

test("v2 native picker holds its draft and route through asynchronous selection", async () => {
  await createRoot(async (dispose) => {
    const a = createPromptState()
    const b = createPromptState()
    let active = a
    const selected = Promise.withResolvers<File>()
    const finished = Promise.withResolvers<void>()
    let stores = 0
    const attach = createPromptInputV2Attachments({
      capture: () => active.capture(),
      editor: () => document.createElement("div"),
      focusEditor: () => {},
      addPart: () => false,
      setDraggingType: () => {},
      directory: () => "/tmp",
      isDialogActive: () => false,
      warn: () => {},
      duplicate: () => {},
      onError: finished.reject,
      normalizeMime: attachmentMime,
      reference: () => (mime, path) => (mime === "text/plain" ? path : undefined),
      insertReference: insertAttachmentReference,
      getPathForFile: (file) => `/tmp/${file.name}`,
      store: async () => {
        stores++
        throw new Error("Text references must not allocate blobs")
      },
      picker: async (_, onFile) => {
        await onFile(await selected.promise)
        finished.resolve()
      },
    })
    attach.pick(() => {})
    active = b
    selected.resolve(new File(["abc"], "a.txt"))
    await finished.promise
    expect(a.current().some((part) => part.type === "file" && part.path === "/tmp/a.txt")).toBe(true)
    expect(b.current().some((part) => part.type === "file")).toBe(false)
    expect(stores).toBe(0)
    dispose()
  })
})
