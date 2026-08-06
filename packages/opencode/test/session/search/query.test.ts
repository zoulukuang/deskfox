// FORK-ONLY test: REQ-095 会话内容搜索 — 查询规划纯函数 [feat: session-content-search]
import { describe, expect, test } from "bun:test"
import { escapeLike, makeSnippet, plan, tokenize } from "../../../src/session/search/query"
import { HL_END, HL_START } from "../../../src/session/search/fts-sql"

describe("session-search.tokenize", () => {
  // U1:中英混合/标点丢弃/空串
  test("中文/英文/混合分词", () => {
    expect(tokenize("会话搜索")).toEqual(["会话搜索"])
    expect(tokenize("fts5 trigram")).toEqual(["fts5", "trigram"])
    expect(tokenize("搜索 error 日志")).toEqual(["搜索", "error", "日志"])
  })
  test("标点/空串/纯符号返回空", () => {
    expect(tokenize("")).toEqual([])
    expect(tokenize("  !!!??……,。  ")).toEqual([])
  })
  test("引号等符号被当分隔符,不注入", () => {
    expect(tokenize(`"quoted" AND (x OR y)`)).toEqual(["quoted", "AND", "x", "OR", "y"])
  })
  test("超长查询截断、token 数量封顶", () => {
    const raw = Array.from({ length: 20 }, (_, i) => `token${i}`).join(" ")
    expect(tokenize(raw).length).toBeLessThanOrEqual(8)
  })
})

describe("session-search.plan", () => {
  // U1/U2:策略路由
  test("全部 token ≥3 字符走 MATCH,短语加引号 AND 连接", () => {
    const result = plan("会话搜索 trigram")
    expect(result).toEqual({ mode: "match", match: `"会话搜索" AND "trigram"`, tokens: ["会话搜索", "trigram"] })
  })
  test("任一 token <3 字符整体走 LIKE(中文双字词场景)", () => {
    const result = plan("报错")
    expect(result).toEqual({ mode: "like", patterns: ["%报错%"], tokens: ["报错"] })
    const mixed = plan("报错 message")
    expect(mixed?.mode).toBe("like")
  })
  test("无有效 token 返回 null", () => {
    expect(plan("")).toBeNull()
    expect(plan("!!!")).toBeNull()
  })
  test("引号被当分隔符切开,MATCH 串不注入", () => {
    const result = plan(`abc"def`)
    expect(result?.mode).toBe("match")
    if (result?.mode === "match") expect(result.match).toBe(`"abc" AND "def"`)
  })
})

describe("session-search.escapeLike", () => {
  test("% _ \\ 全部转义", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b")
  })
})

describe("session-search.makeSnippet", () => {
  // U4:LIKE 路径 TS 侧片段
  test("命中词打标、窗口截断带省略号", () => {
    const body = "x".repeat(100) + "编译报错信息在此" + "y".repeat(100)
    const snippet = makeSnippet(body, ["报错"])
    expect(snippet).toContain(`${HL_START}报错${HL_END}`)
    expect(snippet.startsWith("…")).toBe(true)
    expect(snippet.endsWith("…")).toBe(true)
    expect(snippet.length).toBeLessThan(body.length)
  })
  test("多命中词窗口内全部打标", () => {
    const snippet = makeSnippet("报错 log 报错", ["报错", "log"])
    expect(snippet.split(HL_START).length - 1).toBe(3)
  })
  test("大小写不敏感命中", () => {
    const snippet = makeSnippet("An Error occurred", ["error"])
    expect(snippet).toContain(`${HL_START}Error${HL_END}`)
  })
  test("正文很短不加省略号", () => {
    const snippet = makeSnippet("报错在此", ["报错"])
    expect(snippet).toBe(`${HL_START}报错${HL_END}在此`)
  })
  test("无命中(理论兜底)返回头部截断", () => {
    const body = "z".repeat(200)
    const snippet = makeSnippet(body, ["不存在"])
    expect(snippet.endsWith("…")).toBe(true)
  })
})
