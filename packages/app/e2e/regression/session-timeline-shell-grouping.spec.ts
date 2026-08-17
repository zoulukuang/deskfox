// FORK-ONLY: REQ-109 shell 折叠可配置回归 [feat: session-presentation-input-batch] 2026-08-17
//
// 两套口径都是合法配置,这里正向锁住**产品默认那一套**(折叠);上游那 10+ 条「shell 独立成行」
// 断言由 fixture 种 shellToolPartsGrouped: false 保持零改动全绿,两边互不覆盖。
import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, shell, toolPart, userMessage } from "../performance/timeline-stability/fixture"

const ids = ["prt_grp_sh1", "prt_grp_sh2", "prt_grp_sh3", "prt_grp_sh4", "prt_grp_sh5"]

function shells() {
  return ids.map((id, index) => shell(id, "completed", `out ${index + 1}`, `echo cmd-${index + 1}`))
}

test("连续 shell 默认收进一个「已运行 N 条命令」组,点开可见每条命令", async ({ page }) => {
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage(shells())],
    settings: { shellToolPartsGrouped: true },
    reducedMotion: true,
  })

  // 折叠态:5 条命令只占一行摘要,单条卡片不铺开
  const group = page.locator('[data-component="context-tool-group-trigger"]')
  await expect(group).toHaveCount(1)
  await expect(group).toContainText("5")
  for (const id of ids) {
    await expect(page.locator(`[data-timeline-part-id="${id}"]`)).toHaveCount(0)
  }

  // 展开后每条命令可见
  await group.click()
  const items = page.locator('[data-slot="context-tool-group-item"]')
  await expect(items).toHaveCount(5)
  await expect(items.first()).toContainText("echo cmd-1")
  await expect(items.last()).toContainText("echo cmd-5")
})

test("关掉开关即回上游口径:每条 shell 独立成行", async ({ page }) => {
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage(shells())],
    settings: { shellToolPartsGrouped: false },
    reducedMotion: true,
  })

  await expect(page.locator('[data-component="context-tool-group-trigger"]')).toHaveCount(0)
  for (const id of ids) {
    await expect(page.locator(`[data-timeline-part-id="${id}"]`)).toHaveCount(1)
  }
})

test("命令组与「已探索」组互不吞并 —— 各自成行", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        // 探索簇
        toolPart("prt_grp_read", "read", "completed", { filePath: "a.ts" }, { title: "a.ts", output: "code" }),
        // 命令簇
        shell("prt_grp_cmd1", "completed", "out", "echo one"),
        shell("prt_grp_cmd2", "completed", "out", "echo two"),
      ]),
    ],
    settings: { shellToolPartsGrouped: true },
    reducedMotion: true,
  })

  await expect(page.locator('[data-component="context-tool-group-trigger"]')).toHaveCount(2)
})
