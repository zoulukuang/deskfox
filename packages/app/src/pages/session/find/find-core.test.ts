// FORK-ONLY test: REQ-097 会话内查找纯逻辑 [feat: in-session-find]
import { describe, expect, test } from "bun:test"
import { buildOccurrences, countOccurrences, indexForAnchor, stepIndex, type TurnUnit } from "./find-core"

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

const units: TurnUnit[] = [
  { anchorID: "m1", unitID: "m1", isUser: true, text: "报错一次" },
  { anchorID: "m1", unitID: "prt_a", isUser: false, text: "回复里报错两次,报错" },
  { anchorID: "m2", unitID: "m2", isUser: true, text: "没有" },
  { anchorID: "m3", unitID: "prt_b", isUser: false, text: "报错" },
]

describe("find-core.buildOccurrences", () => {
  test("按单元序展开(单元内序即会话内容序)", () => {
    expect(buildOccurrences(units, "报错")).toEqual([
      { anchorID: "m1", unitID: "m1", isUser: true, indexInUnit: 0 },
      { anchorID: "m1", unitID: "prt_a", isUser: false, indexInUnit: 0 },
      { anchorID: "m1", unitID: "prt_a", isUser: false, indexInUnit: 1 },
      { anchorID: "m3", unitID: "prt_b", isUser: false, indexInUnit: 0 },
    ])
  })
  test("空白查询返回空", () => {
    expect(buildOccurrences(units, "  ")).toEqual([])
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
  const occurrences = buildOccurrences(units, "报错")
  test("定位到锚点轮次的第一个出现", () => {
    expect(indexForAnchor(occurrences, "m3")).toBe(3)
  })
  test("锚点无命中回退 0;无锚点回退 0;空列表 -1", () => {
    expect(indexForAnchor(occurrences, "m9")).toBe(0)
    expect(indexForAnchor(occurrences, undefined)).toBe(0)
    expect(indexForAnchor([], "m1")).toBe(-1)
  })
})
