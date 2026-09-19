import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createPromptState, DEFAULT_PROMPT } from "./prompt-state"
// FORK 2026-09-19 第四轮 code-review:历史往返后的去重闸(见下面 describe)
import {
  contextItemsToHistoryComments,
  historyCommentToContextItem,
} from "@/components/prompt-input/history"

describe("prompt state initialization", () => {
  test("initializes prompt text, cursor, and model together", () => {
    createRoot((dispose) => {
      const model = { providerID: "anthropic", modelID: "claude", variant: "high" }
      const prompt = createPromptState({ prompt: "hello", model })

      expect(prompt.current()).toEqual([{ type: "text", content: "hello", start: 0, end: 5 }])
      expect(prompt.cursor()).toBe(5)
      expect(prompt.model.current()).toEqual(model)
      expect(prompt.model.current()).not.toBe(model)
      dispose()
    })
  })

  test("uses the default prompt without initial values", () => {
    createRoot((dispose) => {
      const prompt = createPromptState()

      expect(prompt.current()).toEqual(DEFAULT_PROMPT)
      expect(prompt.cursor()).toBeUndefined()
      expect(prompt.model.current()).toBeUndefined()
      dispose()
    })
  })
})

// FORK 2026-09-19 第四轮 code-review —— 用户可见现象的端到端闸(跨 history.ts × prompt-state.ts)。
// [bug-repro: 快照产出侧曾写 `id: item.commentID ?? item.key`,于是无注释的选区卡往返一次
//  就被塞上伪 commentID,`contextItemKey` 从 `file:/a.ts:3:5` 变成 `file:/a.ts:3:5:c=file:/a.ts:3:5`。
//  用户操作序列:右键「把选区加入聊天」→ 发送 → ↑ 翻回历史 → 回到文件再选同一段加入聊天
//  → 输入框出现**两张同源卡**,一并发给模型(REQ-116 白烧 token 那一族)。]
describe("历史往返后的引用卡去重(2026-09-19 code-review)", () => {
  const selection = { startLine: 3, startChar: 0, endLine: 5, endChar: 0 }
  const card = { type: "file" as const, path: "/a.ts", selection }

  // ↑ 翻历史:快照 → 回填,与两个 composer 的 applyHistoryComments 同路
  const historyRoundTrip = (prompt: ReturnType<typeof createPromptState>) => {
    const snapshot = contextItemsToHistoryComments({ items: prompt.context.items(), comments: [] })
    prompt.context.replaceComments(snapshot.map(historyCommentToContextItem))
  }

  test("🔴 无注释的选区卡:翻过历史后再加同一段选区,仍然只有一张卡", () => {
    createRoot((dispose) => {
      const prompt = createPromptState()
      prompt.context.add(card)
      expect(prompt.context.items()).toHaveLength(1)

      historyRoundTrip(prompt)
      expect(prompt.context.items()).toHaveLength(1)

      prompt.context.add(card)
      expect(prompt.context.items()).toHaveLength(1)
      dispose()
    })
  })

  test("🔴 无选区的附件卡:同样不得在往返后变成两张", () => {
    createRoot((dispose) => {
      const prompt = createPromptState()
      const attachment = { type: "file" as const, path: "/img.png" }
      prompt.context.add(attachment)
      historyRoundTrip(prompt)
      prompt.context.add(attachment)
      expect(prompt.context.items()).toHaveLength(1)
      dispose()
    })
  })

  test("🔒 真批注卡往返后仍按 commentID 区分 —— 同文件多张不同批注不会被并成一张", () => {
    createRoot((dispose) => {
      const prompt = createPromptState()
      prompt.context.add({ ...card, comment: "一", commentID: "c1" })
      prompt.context.add({ ...card, comment: "二", commentID: "c2" })
      expect(prompt.context.items()).toHaveLength(2)

      historyRoundTrip(prompt)
      expect(prompt.context.items().map((item) => item.commentID)).toEqual(["c1", "c2"])
      dispose()
    })
  })
})
