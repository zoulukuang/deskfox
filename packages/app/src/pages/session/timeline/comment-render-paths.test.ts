// [bug-repro: REQ-131 首版只改了 v2 布局的 CommentCardV2,漏了经典布局的 CommentStrip 行 ——
//             聊天引用卡片上仍印着伪路径 `<chat selection>`,用户看不出引用了什么]
// 2026-09-17 · [feat: release-closeout-2026-09] · user 真机截图反馈
//
// 时间线上的引用卡片有**两条**渲染路径,分居两个包:
//   · v2 布局:packages/session-ui/src/v2/components/comment-card-v2.tsx
//   · 经典布局:packages/app/src/pages/session/timeline/message-timeline.tsx 的 CommentStrip 行
// 这两条必须同进同退。首版漏改一条就出了这个 bug,而且线上没有任何报错。
// 本测试是那道闸:两边都必须用 core 的共享实现,且都不许再裸打 path 当文件名。

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const HERE = import.meta.dir
const TIMELINE = readFileSync(join(HERE, "message-timeline.tsx"), "utf8")
const CARD_V2 = readFileSync(
  join(HERE, "..", "..", "..", "..", "..", "session-ui", "src", "v2", "components", "comment-card-v2.tsx"),
  "utf8",
)

/** 取出 CommentStrip 那段渲染代码 */
function commentStripBlock() {
  const begin = TIMELINE.indexOf('case "CommentStrip"')
  expect(begin).toBeGreaterThan(-1)
  const end = TIMELINE.indexOf('case "UserMessage"', begin)
  expect(end).toBeGreaterThan(begin)
  return TIMELINE.slice(begin, end)
}

describe("引用卡片两条渲染路径必须同进同退", () => {
  test("经典布局 CommentStrip 用共享的 commentQuoteLabel", () => {
    expect(commentStripBlock()).toContain("commentQuoteLabel")
  })

  test("v2 布局 CommentCardV2 用同一个共享实现", () => {
    expect(CARD_V2).toContain("commentQuoteLabel")
  })

  test("两边都从 core 的同一个模块引入 —— 不许各写各的", () => {
    const from = /from "@opencode-ai\/core\/fork\/comment-note"/
    expect(TIMELINE).toMatch(from)
    expect(CARD_V2).toMatch(from)
  })

  test("经典布局按 kind / 伪路径分流,不再无条件拿 path 当文件名", () => {
    const block = commentStripBlock()
    expect(block).toContain("isChatSelectionPath")
    expect(block).toMatch(/kind === "chat"/)
  })

  test("两边都用 isBlankComment 挡住占位注释 —— 别把英文占位当用户写的内容显示", () => {
    expect(commentStripBlock()).toContain("isBlankComment")
    expect(CARD_V2).toContain("isBlankComment")
  })

  test("🔒 经典布局里 getFilename(path) 只能出现在非聊天引用的 fallback 分支内", () => {
    const block = commentStripBlock()
    const idxFallback = block.indexOf("fallback=")
    const idxFilename = block.indexOf("getFilename(comment().path)")
    expect(idxFilename).toBeGreaterThan(-1)
    // 文件名渲染必须在 fallback 之后 —— 即"不是聊天引用"时才走
    expect(idxFilename).toBeGreaterThan(idxFallback)
  })
})

// user 2026-09-17 追加反馈:「在引用内容前增加引用标记 —— 一个聊天小图标,然后是『引用:』冒号之后接引用内容」
// 文件引用同理:「加一个文档的标记,在标记之后写『引用:』,从文档里引用的内容,这样识别度更高」
describe("引用卡片统一格式:[图标] 引用:<引文>", () => {
  test("经典布局:聊天引用用气泡图标,文件引用用文件图标", () => {
    const block = commentStripBlock()
    expect(block).toContain('name="bubble-5"')
    expect(block).toContain("FileIcon")
  })

  test("经典布局:引文前面有「引用:」前缀", () => {
    expect(commentStripBlock()).toContain("prompt.context.quotePrefix")
  })

  test("v2 布局:同样是气泡/文件图标 + 引用前缀", () => {
    expect(CARD_V2).toContain('name="bubble-5"')
    expect(CARD_V2).toContain("quotePrefix")
  })

  test("两条路径都以「有没有引文」决定显引文还是回落文件名 —— 老消息不受影响", () => {
    expect(commentStripBlock()).toContain("commentQuoteLabel(comment().preview)")
    expect(CARD_V2).toMatch(/when=\{props\.preview\?\.trim\(\)\}/)
  })

  test("经典布局给 hover 全文(引文 + 文件名:行范围退到 title)", () => {
    expect(commentStripBlock()).toContain("quoteHover(comment())")
  })
})

// 输入框里的卡片(context-items.tsx)是第三个位置 —— user 反馈文件引用 hover 只显示路径、看不到选中内容
describe("输入框引用卡片:文件引用也要 hover 出引文", () => {
  const COMPOSER = readFileSync(
    join(HERE, "..", "..", "..", "components", "prompt-input", "context-items.tsx"),
    "utf8",
  )

  test("有引文时 tooltip 显「引用:<全文>」,不再只有路径", () => {
    expect(COMPOSER).toContain("prompt.context.quotePrefix")
    expect(COMPOSER).toMatch(/isChatQuote \|\| item\.preview/)
  })

  test("占位注释不占卡片正文", () => {
    expect(COMPOSER).toContain("isBlankComment")
  })

  test("纯文件附件(无引文)保持原样只显路径 —— 不给它硬凑引用", () => {
    expect(COMPOSER).toContain("{directory}")
    expect(COMPOSER).toContain("{filename}")
  })
})
