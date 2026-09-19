// FORK-ONLY:v2 composer 的「上下文卡判据」回归闸。
// [feat: e2e-context-flow-harness] 2026-09-19
//
// [bug-repro: `comments()`(卡片条渲染侧)与 `canSubmit()`(有没有东西可发)原先都以
//  `!!item.comment?.trim()` 为判据,而 fork 侧 2026-09-17 那批已把「无注释的选区卡 /
//  无选区的附件卡也能提交」放宽到三处(context-gate 的 contextItemCount、
//  clearableContextItems、prompt-state 的 isCommentItem)—— 唯独这两处没同源。
//  后果:无注释的卡进了 store 却不渲染、也不算「有东西可发」→ 用户界面零反应,
//  而那张卡之后会跟着下一条消息一起发给模型。]
//
// 为什么是单测而不是 e2e:DeskFox 只用经典布局(legacy composer),v2 不在 e2e 覆盖面内
// (user 2026-09-19 拍板)。但判据本身与布局无关,单测能把它钉住 —— 否则这两行将来
// 被"顺手改回去"没有任何东西会红。
//
// 注:直接构造真 controller 跑,不在测试里复刻判据(复刻 = 测逻辑副本,本仓踩过多次)。

import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createPromptInputV2Controller } from "./interaction"
import type { PromptInputV2Comment, PromptInputV2PersistedState } from "./types"

const noop = () => {}

function withController<T>(
  items: PromptInputV2Comment[],
  prompt: PromptInputV2PersistedState["prompt"],
  run: (controller: ReturnType<typeof createPromptInputV2Controller>) => T,
): T {
  return createRoot((dispose) => {
    const controller = createPromptInputV2Controller({
      store: createStore<PromptInputV2PersistedState>({
        prompt,
        cursor: 0,
        model: { providerID: "anthropic", modelID: "claude-sonnet", variant: null },
        context: { items },
      }),
      commands: () => [],
      context: () => [],
      searchContextFiles: () => [],
      view: {
        submit: { stopping: () => false, onSubmit: noop, onStop: noop },
      },
    })
    try {
      return run(controller)
    } finally {
      dispose()
    }
  })
}

const card = (key: string, comment?: string): PromptInputV2Comment => ({
  type: "file",
  key,
  path: `/src/${key}.ts`,
  comment,
})

const emptyPrompt: PromptInputV2PersistedState["prompt"] = [{ type: "text", content: "", start: 0, end: 0 }]

describe("v2 上下文卡判据(渲染侧 / 提交闸)", () => {
  test("🔴 渲染侧不得按「有没有注释」筛卡", () => {
    const shown = withController(
      [card("a", "有注释"), card("b", ""), card("c"), card("d", "   ")],
      emptyPrompt,
      (controller) => controller.comments().map((item) => item.key),
    )
    // 四张全要出现:无注释的卡在界面上看不见 = 用户既不知道自己引用了什么,也删不掉
    expect(shown).toEqual(["a", "b", "c", "d"])
  })

  test("🔴 只有一张无注释的卡时,也算「有东西可发」", () => {
    expect(withController([card("solo")], emptyPrompt, (c) => c.canSubmit())).toBe(true)
  })

  test("🔒 什么都没有时仍然不可发(别把守卫放宽到永远为真)", () => {
    expect(withController([], emptyPrompt, (c) => c.canSubmit())).toBe(false)
  })

  test("🔒 纯文本 / 纯图片的既有语义不变", () => {
    expect(withController([], [{ type: "text", content: "hi", start: 0, end: 2 }], (c) => c.canSubmit())).toBe(true)
    expect(
      withController(
        [],
        [
          { type: "text", content: "", start: 0, end: 0 },
          {
            type: "image",
            id: "att-1",
            filename: "a.png",
            mime: "image/png",
            blob: { id: "a", url: "blob:a" },
          },
        ],
        (c) => c.canSubmit(),
      ),
    ).toBe(true)
  })
})
