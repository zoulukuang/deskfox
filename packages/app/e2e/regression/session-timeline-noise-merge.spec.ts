// FORK-ONLY: REQ-113 时间线噪声治理 [feat: session-presentation-input-batch] 2026-08-17
//
// 两类噪声按各自的分寸治:
//   A. invalid = 纯噪声(内容逐字相同)→ 合并成一行计数、可展开看每条
//   B. edit/write = 有副作用、最需要被看见 → **不进折叠组**,只把同文件连续编辑合成一行 + ×N
import { expect, test } from "@playwright/test"
import { assistantMessage, setupTimeline, toolPart, userMessage } from "../performance/timeline-stability/fixture"

const invalidPart = (id: string) =>
  toolPart(id, "invalid", "error", { tool: "TaskCreate" }, { error: "Model tried to call unavailable tool 'TaskCreate'" })

const editPart = (id: string, filePath: string) =>
  toolPart(
    id,
    "edit",
    "completed",
    { filePath, oldString: "a", newString: "b" },
    { title: filePath, output: "", metadata: { filediff: { file: filePath, additions: 1, deletions: 1 } } },
  )

test("REQ-113A 连续 invalid 合并成一行计数,点开可见每条详情", async ({ page }) => {
  const ids = ["prt_inv1", "prt_inv2", "prt_inv3", "prt_inv4", "prt_inv5", "prt_inv6", "prt_inv7"]
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage(ids.map(invalidPart))],
    reducedMotion: true,
  })

  const group = page.locator('[data-component="context-tool-group-trigger"]')
  await expect(group).toHaveCount(1)
  await expect(group).toContainText("7")
  // 折叠态:7 条不再各占一行
  for (const id of ids) {
    await expect(page.locator(`[data-timeline-part-id="${id}"]`)).toHaveCount(0)
  }

  await group.click()
  await expect(page.locator('[data-slot="context-tool-group-item"]')).toHaveCount(7)
})

test("REQ-113B 同文件连续编辑合并成一行 + ×N,文件名仍在标题上直接可见", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        editPart("prt_ed1", "src/import_opt_basic.py"),
        editPart("prt_ed2", "src/import_opt_basic.py"),
        editPart("prt_ed3", "src/import_opt_basic.py"),
        editPart("prt_ed4", "src/import_opt_basic.py"),
      ]),
    ],
    reducedMotion: true,
  })

  // 合并成一张编辑卡(取最后一次编辑),不是折叠组
  const editCards = page.locator('[data-component="edit-tool"]')
  await expect(editCards).toHaveCount(1)
  await expect(page.locator('[data-component="context-tool-group-trigger"]')).toHaveCount(0)

  // 文件名 + ×4 都在标题上
  await expect(page.locator('[data-slot="message-part-title-filename"]').first()).toHaveText("import_opt_basic.py")
  await expect(page.locator('[data-slot="message-part-title-repeat"]')).toHaveText("×4")
})

test("REQ-113B 单次编辑仍是独立一行、无 ×N —— 可见性不降级", async ({ page }) => {
  await setupTimeline(page, {
    messages: [userMessage(), assistantMessage([editPart("prt_ed_single", "src/only_once.py")])],
    reducedMotion: true,
  })

  await expect(page.locator('[data-component="edit-tool"]')).toHaveCount(1)
  await expect(page.locator('[data-timeline-part-id="prt_ed_single"]')).toHaveCount(1)
  await expect(page.locator('[data-slot="message-part-title-repeat"]')).toHaveCount(0)
})

test("REQ-113B 换文件 / 夹别的工具都断开重新计数", async ({ page }) => {
  await setupTimeline(page, {
    messages: [
      userMessage(),
      assistantMessage([
        editPart("prt_m1", "a.py"),
        editPart("prt_m2", "a.py"),
        editPart("prt_m3", "b.py"),
        editPart("prt_m4", "b.py"),
        editPart("prt_m5", "b.py"),
      ]),
    ],
    reducedMotion: true,
  })

  await expect(page.locator('[data-component="edit-tool"]')).toHaveCount(2)
  const badges = page.locator('[data-slot="message-part-title-repeat"]')
  await expect(badges).toHaveCount(2)
  await expect(badges.nth(0)).toHaveText("×2")
  await expect(badges.nth(1)).toHaveText("×3")
})
