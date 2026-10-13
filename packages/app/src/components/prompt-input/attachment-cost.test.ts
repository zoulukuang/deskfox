import { expect, test } from "bun:test"
import { ATTACHMENT_CONFIRM_BYTES, inlineAttachmentBytes, singleSubmission } from "./attachment-cost"
import { insertAttachmentReference } from "./attachment-reference"
import { routeExternalDrop } from "./external-drop"

test("byte accounting uses decoded payload size at the exact threshold, including PDF", async () => {
  const parts = await Promise.all(
    [100 * 1024, 100 * 1024 - 1].map(async (size, i) => ({
      type: "image" as const,
      id: String(i),
      filename: "large.pdf",
      mime: "application/pdf",
      blob: { id: String(i), url: "data:application/pdf;base64," + btoa("x".repeat(size)) },
    })),
  )
  expect(await inlineAttachmentBytes(parts)).toBe(ATTACHMENT_CONFIRM_BYTES - 1)
  parts.push({ ...parts[0], blob: { id: "data", url: "data:application/pdf;base64,eA==" } })
  expect(await inlineAttachmentBytes(parts)).toBe(ATTACHMENT_CONFIRM_BYTES)
  parts.push({ ...parts[0], blob: { id: "data2", url: "data:application/pdf,x" } })
  expect(await inlineAttachmentBytes(parts)).toBe(ATTACHMENT_CONFIRM_BYTES + 1)
})

test("submission lock spans asynchronous confirmation and releases on cancellation/error", async () => {
  const pending = Promise.withResolvers<void>()
  let calls = 0
  const submit = singleSubmission(async () => {
    calls++
    await pending.promise
  })
  const first = submit(new Event("submit"))
  await submit(new Event("submit"))
  expect(calls).toBe(1)
  pending.resolve()
  await first
  await submit(new Event("submit"))
  expect(calls).toBe(2)
})

test("only normalized text on a proven local connection uses a path", () => {
  for (const type of ["text/plain", "application/pdf", "image/png", "application/octet-stream", undefined]) {
    for (const local of [true, false]) {
      expect(routeExternalDrop({ type, path: "/tmp/a", local }).kind).toBe(
        type === "text/plain" && local ? "path" : "inline",
      )
      expect(routeExternalDrop({ type, local }).kind).toBe("inline")
    }
  }
})

test("ordered references split captured text at its cursor and recalculate offsets", () => {
  const first = insertAttachmentReference([{ type: "text", content: "hello world", start: 0, end: 11 }], "a.csv", 6)
  const second = insertAttachmentReference(first.parts, "b.txt", first.cursor)
  expect(second.parts.map((part) => ("content" in part ? part.content : "")).join("")).toBe("hello @a.csv @b.txt world")
  expect(second.parts.filter((part) => part.type === "file").map((part) => part.start)).toEqual([6, 13])
  expect(second.cursor).toBe(20)
  expect(insertAttachmentReference(second.parts, "a.csv", second.cursor).parts).toBe(second.parts)
})
