// [bug-repro: 聊天引用提交后,时间线卡片上印着伪路径 `<chat selection>` + 英文占位 `(see selected text)`,
//              用户看不出来自己引用的到底是哪段内容]
// 2026-09-17 · [feat: release-closeout-2026-09]
//
// 这两个工具函数住在 core 的唯一理由:时间线上的引用卡片有**两条**渲染路径 ——
//   · v2 布局:packages/session-ui 的 CommentCardV2
//   · 经典布局:packages/app 的 message-timeline.tsx CommentStrip 行
// 分居两个包,唯一能共用的地方就是 core。REQ-131 首版各写各的,结果只改了前者、漏了后者。

import { describe, expect, test } from "bun:test"
import { commentQuoteLabel, isBlankComment, EMPTY_COMMENT_PLACEHOLDER } from "./comment-note"

describe("commentQuoteLabel · 引文标签", () => {
  test("取首个非空行", () => {
    expect(commentQuoteLabel("药明康德")).toBe("药明康德")
    expect(commentQuoteLabel("第一行\n第二行")).toBe("第一行")
  })

  test("跳过开头的空行/空白行", () => {
    expect(commentQuoteLabel("\n\n   \n真正的第一行")).toBe("真正的第一行")
  })

  test("首行两端空白裁掉", () => {
    expect(commentQuoteLabel("   有空白   \n下一行")).toBe("有空白")
  })

  test("过长截断并加省略号", () => {
    const long = "一二三四五六七八九十" + "一二三四五六七八九十" + "一二三四五六"
    const out = commentQuoteLabel(long)!
    expect(out.length).toBe(25) // 24 + 省略号
    expect(out.endsWith("…")).toBe(true)
  })

  test("恰好等于上限不截断", () => {
    const exact = "一二三四五六七八九十一二三四五六七八九十一二三四" // 24 字
    expect(commentQuoteLabel(exact)).toBe(exact)
  })

  test("无引文 → undefined(由调用方决定回退文案,core 不塞 UI 文案)", () => {
    expect(commentQuoteLabel(undefined)).toBeUndefined()
    expect(commentQuoteLabel("")).toBeUndefined()
    expect(commentQuoteLabel("   \n  \n ")).toBeUndefined()
  })

  test("上限可调", () => {
    expect(commentQuoteLabel("abcdefghij", 4)).toBe("abcd…")
  })
})

describe("isBlankComment · 用户到底写没写注释", () => {
  test("空 / 空白 → 算没写", () => {
    expect(isBlankComment(undefined)).toBe(true)
    expect(isBlankComment("")).toBe(true)
    expect(isBlankComment("   \n ")).toBe(true)
  })

  test("历史英文占位 → 算没写(它不是用户写的,不该显示在卡片上)", () => {
    expect(isBlankComment(EMPTY_COMMENT_PLACEHOLDER)).toBe(true)
    expect(isBlankComment("  (see selected text)  ")).toBe(true)
  })

  test("用户真写的内容 → 算写了", () => {
    expect(isBlankComment("按这个处理吧")).toBe(false)
    expect(isBlankComment("see selected text")).toBe(false) // 没括号,不是占位
  })
})
