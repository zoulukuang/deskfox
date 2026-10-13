import { expect, test } from "bun:test"
import { attachmentText, decodeAttachmentText, limitReadLine, TEXT_MAX_BYTES } from "../src/util/attachment-text"

test("small attachments preserve bytes and newline style", () => {
  for (const text of ["", "hello", "a\r\nb\r\n", "中文😀\n"]) expect(attachmentText(text)).toBe(text)
})

test("line limit and suffix fit the body budget without fake continuation instructions", () => {
  const result = attachmentText("a\n".repeat(2001))
  expect(result.startsWith("a\n".repeat(2000))).toBe(true)
  expect(result).toContain("Attachment truncated")
  expect(result).not.toContain("offset=")
  expect(Buffer.byteLength(result)).toBeLessThanOrEqual(TEXT_MAX_BYTES)
})

test("byte limit includes suffix and only includes complete lines", () => {
  const result = attachmentText(("中".repeat(600) + "\n").repeat(100))
  expect(Buffer.byteLength(result)).toBeLessThanOrEqual(TEXT_MAX_BYTES)
  expect(
    result
      .split("\n")
      .filter((line) => line.startsWith("中"))
      .every((line) => line.length === 600),
  ).toBe(true)
})

test("long line clipping never splits a surrogate pair", () => {
  const result = limitReadLine("a".repeat(1999) + "😀tail")
  expect(result).not.toContain("\ud83d")
  expect(result).toContain("line truncated")
  expect(attachmentText("a".repeat(3000))).toContain("within a line")
})

test("exact limits remain unchanged", () => {
  const text = ("a".repeat(1023) + "\n").repeat(50)
  expect(Buffer.byteLength(text)).toBe(TEXT_MAX_BYTES)
  expect(attachmentText(text)).toBe(text)
  expect(attachmentText("a\n".repeat(2000))).toBe("a\n".repeat(2000))
})

test("valid base64 and percent encodings decode identically", () => {
  const text = "中文😀\n"
  expect(decodeAttachmentText(`data:text/plain;base64,${Buffer.from(text).toString("base64")}`)).toBe(text)
  expect(decodeAttachmentText(`data:text/plain,${encodeURIComponent(text)}`)).toBe(text)
})

test("malformed data URLs fail visibly instead of silently admitting empty text", () => {
  for (const url of [
    "data:text/plain",
    "data:text/plain;base64,!!!",
    "data:text/plain;base64,Y",
    "data:text/plain,%ZZ",
    "data:text/plain;base64,/w==",
  ]) {
    expect(() => decodeAttachmentText(url)).toThrow()
  }
})
