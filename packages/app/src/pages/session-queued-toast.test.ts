// FORK-ONLY 结构闸 —— 队列路径的「未送达」提示不得再声称「已放回输入框」。
// [feat: release-closeout-2026-09] 2026-09-19 第四轮 code-review
//
// [bug-repro: 队列 / 手动重发这条路径同样会抛 PromptNotDeliveredError,上一版为它分流了
//  description(「这条仍在队列里、已标记为失败」),但 title 仍复用通用的
//  `prompt.toast.promptNotDelivered.title` =「这条可能没发出去,已放回输入框」。
//  而这条路径**明确不回输入框**(消息留在队列里、已标 failed)。于是同一个 toast 的标题与正文
//  互相矛盾:用户照标题去输入框找原文,那里是空的,以为内容彻底丢了,重新手打一遍。]
//
// 为什么是结构闸:该分支在 session.tsx 的 followupMutation 闭包里,吃满 sdk / store / toast,
// 搭行为 harness 得复刻一整套 context —— 那正是「测的是逻辑副本而非真代码」的老陷阱。
// 这里直接读真文件断言用的是哪个 key,另加一组字典不变量把两条文案钉开。

import { describe, expect, test } from "bun:test"
import { dict as en } from "../i18n/en"
import { dict as zh } from "../i18n/zh"

const SRC = await Bun.file(new URL("./session.tsx", import.meta.url)).text()

/** 只留代码行:否则注释里出现的 key 名会被当成代码,断言就成了测注释。 */
const CODE = SRC.split("\n")
  .filter((line) => {
    const trimmed = line.trim()
    return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*")
  })
  .join("\n")

/** 队列路径那个 toast 的实参窗口(从 isPromptNotDelivered 分支起、到它的 else 止)。 */
const BRANCH = (() => {
  const start = CODE.indexOf("isPromptNotDelivered(err)")
  expect(start).toBeGreaterThan(-1)
  const end = CODE.indexOf("} else fail(err)", start)
  expect(end).toBeGreaterThan(start)
  return CODE.slice(start, end)
})()

const GENERIC_TITLE = "prompt.toast.promptNotDelivered.title"
const QUEUED_TITLE = "prompt.toast.promptNotDelivered.queued.title"
const QUEUED_DESCRIPTION = "prompt.toast.promptNotDelivered.queued.description"

describe("队列路径的未送达提示", () => {
  test("🔴 title 必须走 queued 专属键,不得复用通用那条", () => {
    expect(BRANCH).toContain(QUEUED_TITLE)
    // 通用 key 是 queued key 的前缀,所以不能直接 not.toContain —— 剔掉 queued 的两处再查。
    const withoutQueued = BRANCH.split(QUEUED_TITLE).join("").split(QUEUED_DESCRIPTION).join("")
    expect(withoutQueued).not.toContain(GENERIC_TITLE)
  })

  test("🔒 description 仍是 queued 专属(别修 title 时把它换回通用)", () => {
    expect(BRANCH).toContain(QUEUED_DESCRIPTION)
  })

  test("🔴 两条 title 的文案必须真的不同 —— 否则等于没分流", () => {
    for (const [locale, dict] of [
      ["en", en],
      ["zh", zh],
    ] as const) {
      expect({ locale, same: dict[QUEUED_TITLE] === dict[GENERIC_TITLE] }).toEqual({ locale, same: false })
    }
  })

  test("🔴 queued title 不得声称「已放回输入框」(这正是当初矛盾的那半句)", () => {
    // 通用那条**应当**这么说(它确实回吐到输入框);queued 那条**不得**这么说。
    expect(en[GENERIC_TITLE].toLowerCase()).toContain("input box")
    expect(en[QUEUED_TITLE].toLowerCase()).not.toContain("input box")
    expect(zh[GENERIC_TITLE]).toContain("输入框")
    expect(zh[QUEUED_TITLE]).not.toContain("输入框")
  })

  test("🔒 queued title 要点明「仍在队列里」,与正文口径一致", () => {
    expect(en[QUEUED_TITLE].toLowerCase()).toContain("queue")
    expect(zh[QUEUED_TITLE]).toContain("队列")
  })
})
