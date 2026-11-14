import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { chmod, mkdtemp, mkdir, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readDocumentPreview } from "./document-preview"

const dirs: string[] = []
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "deskfox-preview-"))
  dirs.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("exact-file document preview", () => {
  test("reads an outside Chinese/space Markdown file and canonicalizes its identity", async () => {
    const root = await fixture()
    const file = path.join(root, "报告 draft.md")
    await writeFile(file, "# 内容\n\n正文")
    expect(await readDocumentPreview({ path: file })).toMatchObject({
      ok: true,
      kind: "markdown",
      content: "# 内容\n\n正文",
    })
  })

  test("returns only the symlink target file, without granting a directory", async () => {
    const root = await fixture()
    const target = path.join(root, "target.txt")
    await writeFile(target, "one exact file")
    const link = path.join(root, "link.txt")
    await symlink(target, link)
    expect(await readDocumentPreview({ path: link })).toMatchObject({
      ok: true,
      path: await realpath(target),
      kind: "text",
      content: "one exact file",
    })
  })

  test("PDF bytes are preserved; Office is validated before conversion", async () => {
    const root = await fixture()
    const pdf = path.join(root, "report.pdf")
    const data = Buffer.from("%PDF-1.7\nfixture")
    await writeFile(pdf, data)
    expect(await readDocumentPreview({ path: pdf })).toMatchObject({
      ok: true,
      kind: "pdf",
      content: data.toString("base64"),
    })
    const office = path.join(root, "report.docx")
    await writeFile(office, "fixture")
    expect(await readDocumentPreview({ path: office })).toMatchObject({ ok: true, kind: "office", content: "" })
  })

  test("HTML and scripts are returned as text, never executed", async () => {
    const root = await fixture()
    const html = path.join(root, "report.html")
    await writeFile(html, "<script>throw new Error('must not execute')</script>")
    expect(await readDocumentPreview({ path: html })).toMatchObject({ ok: true, kind: "text" })
    const file = path.join(root, "run.exe")
    await writeFile(file, "binary")
    expect(await readDocumentPreview({ path: file })).toEqual({ ok: false, reason: "unsupported" })
  })

  test("rejects directories, missing files and relative paths", async () => {
    const root = await fixture()
    await mkdir(path.join(root, "folder.md"))
    expect(await readDocumentPreview({ path: path.join(root, "folder.md") })).toEqual({
      ok: false,
      reason: "directory",
    })
    expect(await readDocumentPreview({ path: path.join(root, "missing.md") })).toEqual({ ok: false, reason: "missing" })
    expect(await readDocumentPreview({ path: "../outside.md" })).toEqual({ ok: false, reason: "invalid" })
  })

  test("bounds text and document allocation before reading", async () => {
    const root = await fixture()
    for (const [name, size] of [
      ["huge.md", 2 * 1024 * 1024 + 1],
      ["huge.pdf", 50 * 1024 * 1024 + 1],
    ] as const) {
      const file = path.join(root, name)
      await writeFile(file, "")
      await truncate(file, size)
      expect(await readDocumentPreview({ path: file })).toEqual({ ok: false, reason: "too-large" })
    }
  })

  test("rejects binary text and invalid UTF-8 without replacing bytes silently", async () => {
    const root = await fixture()
    const file = path.join(root, "binary.txt")
    await writeFile(file, new Uint8Array([255, 0, 1]))
    expect(await readDocumentPreview({ path: file })).toEqual({ ok: false, reason: "encoding" })
  })

  test.skipIf(process.platform === "win32")("rejects a real FIFO before opening it", async () => {
    const root = await fixture()
    const fifo = path.join(root, "pipe.txt")
    execFileSync("mkfifo", [fifo])
    expect(await readDocumentPreview({ path: fifo })).toEqual({ ok: false, reason: "directory" })
  })

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports permission denied for a real unreadable file",
    async () => {
      const root = await fixture()
      const file = path.join(root, "private.txt")
      await writeFile(file, "private")
      await chmod(file, 0)
      try {
        expect(await readDocumentPreview({ path: file })).toEqual({ ok: false, reason: "permission" })
      } finally {
        await chmod(file, 0o600)
      }
    },
  )
})
