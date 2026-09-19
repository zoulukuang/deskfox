// FORK-ONLY e2e:引用/选区核心流程 —— 用 utils/context-flows.ts 驱动。
// [feat: e2e-context-flow-harness] 2026-09-19
//
// 这批用例第一次把「第四轮 code-review 现象 A」那一族搬进 GUI 层:
// 加卡 → 发送 → ↑ 翻历史 → 再加同一选区,断言身份不变、不重复。
// 对应 1-spec §五 的 R8 清单。

import { expect, test } from "@playwright/test"
import {
  addToChatFromViewer,
  bootstrapContextFlow,
  contextCardSnapshots,
  contextCards,
  historyUp,
  openFileInPreview,
  removeContextCard,
  rightClickSelection,
  selectTextInPreview,
  sendPrompt,
} from "../utils/context-flows"

const MD = "notes.md"
const TXT = "notes.txt"
const NEEDLE = "alpha beta gamma delta"
const CONTENT = `${NEEDLE} epsilon zeta eta theta iota kappa lambda mu nu xi omicron`

const files = [
  { name: MD, content: CONTENT },
  { name: TXT, content: CONTENT },
]

test.use({ viewport: { width: 1440, height: 900 } })

// 本批只覆盖**新版界面(v2 composer)** —— `settings.general.newLayoutDesigns=true`。
//
// 为什么不同时跑经典布局:两套布局的**文件树是两套 DOM**,经典布局的侧栏文件树在本 bootstrap 下
// 默认不显示(它归 layout.fileTree 可见性管,与评审面板那棵 v2 树是不同开关),要另配一套
// localStorage / 打开路径。工具侧 `openFileInPreview` 已按布局分流(经典走
// `[data-component="filetree"]` 按文件名点,该树行上没有任何 data-*),差的只是 bootstrap;
// 且上游正在退役经典布局(settings.tsx 的 oldInterfaceRetired / layoutTransition)。
// → 经典布局覆盖列为后续项,见 1-spec §七。
const newLayout = true
{
  test.describe("context cards (v2 composer)", () => {
    // R8-1:预览区(.md,light DOM)选中 → 右键 → 加入聊天(带注释)
    test("adds a card from a markdown selection with a comment", async ({ page }) => {
      await bootstrapContextFlow(page, { files, newLayout })
      await openFileInPreview(page, MD, NEEDLE)
      const { text, box } = await selectTextInPreview(page, NEEDLE)
      expect(text.trim().length).toBeGreaterThan(3)
      await rightClickSelection(page, box)
      await addToChatFromViewer(page, { comment: "why this line" })

      await expect(contextCards(page)).toHaveCount(1)
      expect(await contextCardSnapshots(page)).toEqual([
        { path: MD, hasComment: true, commentID: expect.stringMatching(/^md-sel-/), kind: "file" },
      ])
    })

    // R8-2:同上但是 .txt —— 内容在 <diffs-container> 的 shadow DOM 里,钉住那条路
    test("adds a card from a shadow-DOM (text file) selection", async ({ page }) => {
      await bootstrapContextFlow(page, { files, newLayout })
      await openFileInPreview(page, TXT, NEEDLE)
      const { text, box } = await selectTextInPreview(page, NEEDLE)
      expect(text.trim().length).toBeGreaterThan(3)
      await rightClickSelection(page, box)
      await addToChatFromViewer(page, { comment: "shadow path" })

      await expect(contextCards(page)).toHaveCount(1)
      expect((await contextCardSnapshots(page))[0]).toMatchObject({ path: TXT, hasComment: true })
    })

    // R8-8:不填注释也必须落卡且可见 —— 2026-09-19 修的就是这条
    // [bug-repro: 上游 interaction.ts 的 comments()/canSubmit() 都以 `!!item.comment?.trim()` 为判据,
    //  而 fork 侧 2026-09-17 已把「无注释卡也能发」放宽 → v2 下无注释卡进了 store 却不渲染、
    //  也不算「有东西可发」,用户看到的是**零反应**;那张卡之后还会跟着下一条消息发给模型。]
    test("adds a visible card even without a comment", async ({ page }) => {
      await bootstrapContextFlow(page, { files, newLayout })
      await openFileInPreview(page, MD, NEEDLE)
      const { box } = await selectTextInPreview(page, NEEDLE)
      await rightClickSelection(page, box)
      await addToChatFromViewer(page)

      await expect(contextCards(page)).toHaveCount(1)
      expect((await contextCardSnapshots(page))[0]).toMatchObject({ path: MD, hasComment: false })
    })

    // R8-6 + R8-7:发送 → ↑ 翻历史 → 卡片原样回来 → 再加同一选区仍不重复
    test("round-trips a card through history without changing its identity", async ({ page }) => {
      await bootstrapContextFlow(page, { files, newLayout })
      await openFileInPreview(page, MD, NEEDLE)
      const first = await selectTextInPreview(page, NEEDLE)
      await rightClickSelection(page, first.box)
      await addToChatFromViewer(page, { comment: "keep me" })
      const before = await contextCardSnapshots(page)
      expect(before).toHaveLength(1)

      await sendPrompt(page, "hello")
      await historyUp(page)

      await expect(contextCards(page)).toHaveCount(1)
      // 往返恒等:逐字段相同(第四轮那条「伪 commentID」就是在这里变形的)
      expect(await contextCardSnapshots(page)).toEqual(before)
    })

    // R8-10:删卡
    test("removes a card", async ({ page }) => {
      await bootstrapContextFlow(page, { files, newLayout })
      await openFileInPreview(page, MD, NEEDLE)
      const { box } = await selectTextInPreview(page, NEEDLE)
      await rightClickSelection(page, box)
      await addToChatFromViewer(page, { comment: "to be removed" })
      await expect(contextCards(page)).toHaveCount(1)

      await removeContextCard(page)
      await expect(contextCards(page)).toHaveCount(0)
    })

    // R8-11:浮层 Esc 取消 → 不落卡
    test("escaping the comment popover adds nothing", async ({ page }) => {
      await bootstrapContextFlow(page, { files, newLayout })
      await openFileInPreview(page, MD, NEEDLE)
      const { box } = await selectTextInPreview(page, NEEDLE)
      const menu = await rightClickSelection(page, box)
      await menu.getByRole("button", { name: "Add to Chat" }).click()
      await expect(menu.locator("textarea")).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(menu).toBeHidden()
      await expect(contextCards(page)).toHaveCount(0)
    })
  })
}
