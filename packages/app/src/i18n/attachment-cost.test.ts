import { expect, test } from "bun:test"
import { attachmentCostDict, en, zh } from "./attachment-cost"

test("reviewed attachment translations preserve keys and placeholders; other locales explicitly use English", () => {
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    expect(zh[key].match(/\{\{[^}]+\}\}/g) ?? []).toEqual(en[key].match(/\{\{[^}]+\}\}/g) ?? [])
  }
  expect(attachmentCostDict("zh")).toBe(zh)
  expect(attachmentCostDict("fr")).toBe(en)
})
