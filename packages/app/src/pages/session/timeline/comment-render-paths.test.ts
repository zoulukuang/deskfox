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
