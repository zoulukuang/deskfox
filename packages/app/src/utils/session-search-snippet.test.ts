// FORK-ONLY test: REQ-095 会话内容搜索 — snippet 解析 [feat: session-content-search]
import { describe, expect, test } from "bun:test"
import { parseSnippet, SNIPPET_HL_END, SNIPPET_HL_START } from "./session-search-snippet"

const hl = (text: string) => `${SNIPPET_HL_START}${text}${SNIPPET_HL_END}`

describe("parseSnippet", () => {
  // U3:基本拆分
  test("单命中词拆三段", () => {
    expect(parseSnippet(`前文${hl("报错")}后文`)).toEqual([
      { text: "前文", highlight: false },
      { text: "报错", highlight: true },
      { text: "后文", highlight: false },
    ])
  })
  test("多命中词", () => {
    expect(parseSnippet(`${hl("a")}x${hl("b")}`)).toEqual([
      { text: "a", highlight: true },
      { text: "x", highlight: false },
      { text: "b", highlight: true },
    ])
  })
  test("无标记原样单段", () => {
    expect(parseSnippet("纯文本")).toEqual([{ text: "纯文本", highlight: false }])
  })
  test("空串返回空数组", () => {
    expect(parseSnippet("")).toEqual([])
  })
  // 嵌套容错(LIKE 路径短词命中在长词标记内)
  test("嵌套标记容错并合并", () => {
    const nested = `${SNIPPET_HL_START}报${SNIPPET_HL_START}错${SNIPPET_HL_END}信息${SNIPPET_HL_END}尾`
    expect(parseSnippet(nested)).toEqual([
      { text: "报错信息", highlight: true },
      { text: "尾", highlight: false },
    ])
  })
  test("不配对的结束标记不抛错", () => {
    expect(parseSnippet(`${SNIPPET_HL_END}文本`)).toEqual([{ text: "文本", highlight: false }])
  })
})
