import { expect, test } from "bun:test"
import { createDocumentPreviewOpener, documentBytes, type DocumentPreview } from "./document-preview"

test.each([undefined, ""])("remote or unknown connection never reads a local path: %s", async (source) => {
  const reads: string[] = []
  const open = createDocumentPreviewOpener({
    source: () => source,
    read: async (path) => {
      reads.push(path)
      return { ok: false, reason: "missing" }
    },
    show: () => {
      throw new Error("must not show")
    },
  })
  await expect(open("/remote/report.pdf", "")).rejects.toThrow("本机桌面会话")
  expect(reads).toEqual([])
})

test("opens only the canonical document returned by the native reader", async () => {
  const shown: string[] = []
  const open = createDocumentPreviewOpener({
    source: () => "sidecar",
    read: async () => ({ ok: true, path: "/real/report.md", kind: "markdown", content: "body" }),
    show: (document, fragment) => {
      shown.push(`${document.path}#${fragment}:${document.content}`)
    },
  })
  await open("/link/report.md", "section")
  expect(shown).toEqual(["/real/report.md#section:body"])
})

test("a late response after switching the connection cannot open a local file", async () => {
  let source: string | undefined = "sidecar"
  const pending = Promise.withResolvers<DocumentPreview>()
  const shown: string[] = []
  const open = createDocumentPreviewOpener({
    source: () => source,
    read: () => pending.promise,
    show: (document) => {
      shown.push(document.path)
    },
  })
  const response = open("/tmp/report.pdf", "")
  source = undefined
  pending.resolve({ ok: true, path: "/tmp/report.pdf", kind: "pdf", content: "" })
  await expect(response).rejects.toThrow("连接已切换")
  expect(shown).toEqual([])
})

test.each(["missing", "permission", "unreachable", "unsupported", "too-large"] as const)(
  "reports native failure without false success: %s",
  async (reason) => {
    const shown: string[] = []
    const open = createDocumentPreviewOpener({
      source: () => "sidecar",
      read: async () => ({ ok: false, reason }),
      show: (document) => {
        shown.push(document.path)
      },
    })
    await expect(open("/tmp/file.pdf", "")).rejects.toThrow()
    expect(shown).toEqual([])
  },
)

test("preserves binary PDF bytes across the IPC base64 contract", () => {
  expect(documentBytes("JVBERgD/AA==")).toEqual(new Uint8Array([37, 80, 68, 70, 0, 255, 0]))
})
