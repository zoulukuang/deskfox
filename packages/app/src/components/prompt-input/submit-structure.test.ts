// 结构闸 —— 守两条**位置即语义**的不变量,以及一条"别再声称做了却没做"的覆盖面不变量。
//
// 为什么用读源码的结构闸而不是行为测试:这三条都落在 `createPromptSubmit` 返回的 `handleSubmit`
// 里,那是一个吃满 editor / toast / sdk / permission / worktree 的大闭包,为它搭行为 harness
// 的成本远高于收益,而且**搭出来的多半是逻辑副本**(本批已经栽过一次:测试测的是副本不是真代码)。
// 结构闸直接读真文件,断言"这行在那行之前 / 这条路径确实套了闸",退化时立刻变红。
//
// 2026-09-18 第三轮 code-review · [feat: release-closeout-2026-09]

import { describe, expect, test } from "bun:test"

// 🔴 行尾归一化 —— 不是可选的。Win 工作区是 CRLF(`core.autocrlf=true`,而 .gitattributes
//   只对 packages/app/src/i18n/*.ts 强制 LF),而本文件的断言读的是**源码原文**:
//   任何以 `\n` 开头或结尾的正则在 Win 上都会撞上 `\r` 而**假红** —— 被测代码完全正常。
//   [bug-repro: `/\n\s*return\n/` 那条在 mac 上绿、在 Win 上必红 —— `\s*` 吃掉了 `return` 前面
//    那个 `\r`,但结尾的 `\n` 撞上 `\r` 匹配不到。而 pre-push 无分支条件地跑 packages/app 单测,
//    于是 **Win 侧任何 push 全被挡**,含 /ship 步骤 6 推 chore 分支与 tag —— 发版卡死在第一次 push。]
//   归一化放在这里、而不是逐条正则加 `\r?`:后续往本文件新增断言的人不必再想起这件事。
//   2026-09-19
const SRC = (await Bun.file(new URL("./submit.ts", import.meta.url)).text()).replace(/\r\n/g, "\n")

/** 取 handleSubmit 函数体(到下一个同缩进的顶层定义为止,足够覆盖本文件断言的范围) */
const HANDLE_SUBMIT = (() => {
  const start = SRC.indexOf("const handleSubmit = async")
  expect(start).toBeGreaterThan(-1)
  return SRC.slice(start)
})()

describe("停止兜底的撤销时机", () => {
  // [bug-repro: `cancelStopFallback` 首版放在 handleSubmit 前部、**队列分支之前**。
  //  后端半死时点停止(interrupt 不回包)→ 4s 兜底已武装 → 4 秒内再输入一条 →
  //  因状态仍 busy 命中 shouldQueue → 但兜底已被提前撤销 → 状态永久停在 busy →
  //  而队列排干的前提正是 !busy → 消息卡在队列里永不发出,spinner 永不停。
  //  修复前兜底会在 4s 后置 idle 并把队列排干,所以这是修复自身引入的、比原 bug 更重的回归。]
  test("🔴 撤销必须在队列分支之后 —— 走队列的那一发并没有真的发出去", () => {
    const queueBranch = HANDLE_SUBMIT.indexOf("input.shouldQueue?.()")
    const cancel = HANDLE_SUBMIT.indexOf("cancelStopFallback(params.id)")
    expect(queueBranch).toBeGreaterThan(-1)
    expect(cancel).toBeGreaterThan(-1)
    expect(cancel).toBeGreaterThan(queueBranch)
  })

  test("🔒 队列分支自身仍是 early return —— 若它不再 return,上面的顺序断言就失去意义", () => {
    const i = HANDLE_SUBMIT.indexOf("input.shouldQueue?.()")
    const window = HANDLE_SUBMIT.slice(i, HANDLE_SUBMIT.indexOf("cancelStopFallback(params.id)"))
    expect(window).toContain("input.onQueue?.(draft)")
    expect(window).toMatch(/\n\s*return\n/)
  })

  test("🔒 followup / 队列排干那条路径也要撤销(它同样是「新一轮发送」)", () => {
    const followup = SRC.slice(SRC.indexOf("export async function sendFollowupDraft"))
    expect(followup.slice(0, followup.indexOf("const text = draftText"))).toContain("cancelStopFallback")
  })
})

describe("送达超时的覆盖面", () => {
  // [bug-repro: commit message 声称"抽成 withDeliveryDeadline helper,三处同待遇",
  //  实际全仓只有 sendFollowupDraft 的 command 分支调了它一次;主 /command 路径与 prompt 路径都没用上。
  //  主 /command 路径先 clearInput() 又置 busy,再裸 `.catch` —— 后端半死时请求永不 settle,
  //  `.catch` 永不触发,用户输入的斜杠命令连同附件直接蒸发、状态永久 busy。]
  test("🔴 三条把消息交给后端的路径都套了 withDeliveryDeadline", () => {
    // 只数**调用**:定义那行是 `withDeliveryDeadline<T>(`,不会被误计。
    const calls = SRC.split("withDeliveryDeadline(").length - 1
    expect(calls).toBeGreaterThanOrEqual(3)
  })

  test("🔴 主 /command 路径不得再出现裸 `.catch` 直发", () => {
    const i = SRC.indexOf("const customCommand = sync().data.command.find")
    expect(i).toBeGreaterThan(-1)
    const block = SRC.slice(i, SRC.indexOf("// FORK-BEGIN: 发送后清空", i))
    expect(block).toContain("withDeliveryDeadline")
    // 发出去之前已经 clearInput() —— 所以失败时必须有回吐,不能只弹 toast
    expect(block).toContain("restoreInput()")
  })

  test("🔒 未送达与后端报错走不同文案 —— 三条路径一致", () => {
    // 未送达不能说死"没发出去":服务端可能已 admit 只是回包慢(见文件头 REQ-135 说明)。
    const occurrences = SRC.split("isPromptNotDelivered(err)").length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })
})
