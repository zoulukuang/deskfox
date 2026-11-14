import { expect, test } from "bun:test"
import { isVcsMetadataPath } from "./vcs-event"

test.each([
  ["/repo/.git/HEAD", "/repo"],
  ["/repo/.git/index", "/repo/"],
  [".git/HEAD", "/repo"],
  ["./.git/HEAD", "/repo"],
  ["/.git/HEAD", "/"],
  ["C:\\Repo\\.git\\HEAD", "C:\\Repo"],
  ["c:/repo/.git/HEAD", "C:/Repo"],
  ["\\\\host\\share\\repo\\.git\\HEAD", "\\\\host\\share\\repo"],
])("filters Git metadata %s", (file, directory) => {
  expect(isVcsMetadataPath(file, directory)).toBe(true)
})

test.each([
  ["/repo/.gitignore", "/repo"],
  ["/repo/.github/workflow.yml", "/repo"],
  ["/repo-other/.git/HEAD", "/repo"],
  ["/repo/src/.git/HEAD", "/repo"],
  ["/repo/%2egit/HEAD", "/repo"],
  ["/repo/#/.git/HEAD", "/repo"],
  ["/repo/.git\\data", "/repo"],
])("preserves ordinary or unknown paths %s", (file, directory) => {
  expect(isVcsMetadataPath(file, directory)).toBe(false)
})
