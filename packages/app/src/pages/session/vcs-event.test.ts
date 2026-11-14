import { expect, test } from "bun:test"
import { shouldIgnoreVcsMetadata } from "./vcs-event"

test.each([
  ["/repo/.git/index", "/repo"],
  ["/repo/.git/index", "/repo/"],
  [".git/index", "/repo"],
  ["./.git/index", "/repo"],
  ["/.git/index", "/"],
  ["C:\\Repo\\.git\\index", "C:\\Repo"],
  ["c:/repo/.git/index", "C:/Repo"],
  ["\\\\host\\share\\repo\\.git\\index", "\\\\host\\share\\repo"],
])("filters Git metadata %s", (file, directory) => {
  expect(shouldIgnoreVcsMetadata(file, directory)).toBe(true)
})

test.each([
  ["/repo/.git/HEAD", "/repo"],
  [".git/HEAD", "/repo"],
  ["C:\\Repo\\.git\\HEAD", "C:\\Repo"],
  ["\\\\host\\share\\repo\\.git\\HEAD", "\\\\host\\share\\repo"],
  ["/repo/.gitignore", "/repo"],
  ["/repo/.github/workflow.yml", "/repo"],
  ["/repo-other/.git/HEAD", "/repo"],
  ["/repo/src/.git/HEAD", "/repo"],
  ["/repo/%2egit/HEAD", "/repo"],
  ["/repo/#/.git/HEAD", "/repo"],
  ["/repo/.git\\data", "/repo"],
])("preserves ordinary or unknown paths %s", (file, directory) => {
  expect(shouldIgnoreVcsMetadata(file, directory)).toBe(false)
})
