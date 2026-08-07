// FORK-ONLY test: REQ-097 会话内查找纯逻辑 [feat: in-session-find]
import { describe, expect, test } from "bun:test"
import { buildOccurrences, countOccurrences, indexForAnchor, stepIndex } from "./find-core"

describe("find-core.countOccurrences", () => {
  test("中文子串多次出现", () => {
    expect(countOccurrences("编译报错,又是编译报错", "编译报错")).toBe(2)
  })
  test("大小写不敏感", () => {
    expect(countOccurrences("Error error ERROR", "error")).toBe(3)
  })
  test("空查询/无命中为 0", () => {
    expect(countOccurrences("abc", "")).toBe(0)
    expect(countOccurrences("abc", "xyz")).toBe(0)
  })
  test("重叠不重复计数", () => {
    expect(countOccurrences("aaa", "aa")).toBe(1)
  })
})

describe("find-core.buildOccurrences", () => {
  const turns = [
    { anchorID: "m1", text: "报错一次" },
    { anchorID: "m2", text: "没有" },
    { anchorID: "m3", text: "报错两次,报错" },
  ]
  test("按轮次序展开为扁平出现列表", () => {
    expect(buildOccurrences(turns, "报错")).toEqual([
      { anchorID: "m1", localIndex: 0 },
      { anchorID: "m3", localIndex: 0 },
      { anchorID: "m3", localIndex: 1 },
    ])
  })
  test("空白查询返回空", () => {
    expect(buildOccurrences(turns, "  ")).toEqual([])
  })
})

describe("find-core.stepIndex", () => {
  test("环形前进/后退", () => {
    expect(stepIndex(0, 3, 1)).toBe(1)
    expect(stepIndex(2, 3, 1)).toBe(0)
    expect(stepIndex(0, 3, -1)).toBe(2)
  })
  test("未定位时(-1)按方向落到端点", () => {
    expect(stepIndex(-1, 3, 1)).toBe(0)
    expect(stepIndex(-1, 3, -1)).toBe(2)
  })
  test("无命中返回 -1", () => {
    expect(stepIndex(0, 0, 1)).toBe(-1)
  })
})

describe("find-core.indexForAnchor", () => {
  const occurrences = [
    { anchorID: "m1", localIndex: 0 },
    { anchorID: "m3", localIndex: 0 },
    { anchorID: "m3", localIndex: 1 },
  ]
  test("定位到锚点轮次的第一个出现", () => {
    expect(indexForAnchor(occurrences, "m3")).toBe(1)
  })
  test("锚点无命中回退 0;无锚点回退 0;空列表 -1", () => {
    expect(indexForAnchor(occurrences, "m9")).toBe(0)
    expect(indexForAnchor(occurrences, undefined)).toBe(0)
    expect(indexForAnchor([], "m1")).toBe(-1)
  })
})
