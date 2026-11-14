// FORK-ONLY: exact drive href exception, no broader scheme allowance [feat: daily-file-links] 2026-11-14
import { expect, test } from "bun:test"
import { preserveWindowsFileLink } from "./markdown-file-links"
import type { DOMPurify, UponSanitizeAttributeHookEvent } from "dompurify"

test.each(["C:/work/file%20name.md", "d:\\work\\file.md"])("retains an absolute drive href: %s", (href) => {
  const attribute: UponSanitizeAttributeHookEvent = {
    attrName: "href",
    attrValue: href,
    keepAttr: true,
    allowedAttributes: {},
    forceKeepAttr: undefined,
  }
  preserveWindowsFileLink.call({} as DOMPurify, { tagName: "A" } as Element, attribute, {})
  expect(attribute.forceKeepAttr).toBe(true)
})

test.each([
  "javascript:alert(1)",
  "data:text/html,test",
  "file:///tmp/a",
  "localasset://localhost/L3RtcA/a",
  "C:relative.md",
  "http://example.test",
  "../file.md",
])("does not override sanitization of %s", (href) => {
  const attribute: UponSanitizeAttributeHookEvent = {
    attrName: "href",
    attrValue: href,
    keepAttr: false,
    allowedAttributes: {},
    forceKeepAttr: undefined,
  }
  preserveWindowsFileLink.call({} as DOMPurify, { tagName: "A" } as Element, attribute, {})
  expect(attribute.forceKeepAttr).toBeUndefined()
})

test.each([
  ["IMG", "src"],
  ["IMAGE", "href"],
  ["A", "style"],
])("never grants resource attributes: %s %s", (tagName, attrName) => {
  const attribute: UponSanitizeAttributeHookEvent = {
    attrName,
    attrValue: "C:/private.png",
    keepAttr: false,
    allowedAttributes: {},
    forceKeepAttr: undefined,
  }
  preserveWindowsFileLink.call({} as DOMPurify, { tagName } as Element, attribute, {})
  expect(attribute.forceKeepAttr).toBeUndefined()
})
