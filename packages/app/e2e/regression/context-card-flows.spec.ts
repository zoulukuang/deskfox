// FORK-ONLY e2e:引用/选区核心流程 —— 用 utils/context-flows.ts 驱动。
// [feat: e2e-context-flow-harness] 2026-09-19
//
// 这批用例第一次把「第四轮 code-review 现象 A」那一族搬进 GUI 层:
// 加卡 → 发送 → ↑ 翻历史 → 再加同一选区,断言身份不变、不重复。
// 对应 1-spec §五 的 R8 清单。

import { expect, test } from "@playwright/test"
import {
  addToChatFromMenu,
  addToChatFromViewer,
  bootstrapContextFlow,
  contextCardSnapshots,
  contextCards,
  historyUp,
  mentionFile,
  openFileInPreview,
  removeContextCard,
  rightClickSelection,
  selectTextInChat,
  selectTextInPreview,
  sendPrompt,
} from "../utils/context-flows"

const MD = "notes.md"
const TXT = "notes.txt"
const NEEDLE = "alpha beta gamma delta"
const CONTENT = `${NEEDLE} epsilon zeta eta theta iota kappa lambda mu nu xi omicron`
const CHAT_QUOTE = "the quick brown fox jumps over the lazy dog"

const files = [
  { name: MD, content: CONTENT },
  { name: TXT, content: CONTENT },
]

test.use({ viewport: { width: 1440, height: 900 } })

// 只覆盖 **DeskFox 当前在用的经典布局**(`settings.general.newLayoutDesigns=false`)——
// user 2026-09-19 拍板「以后只用这种布局」。工具侧也已收口成单布局,不再兼容 v2 composer。
test.describe("context cards", () => {
  // R8-1:预览区(.md,light DOM)选中 → 右键 → 加入聊天(带注释)
  test("adds a card from a markdown selection with a comment", async ({ page }) => {
    await bootstrapContextFlow(page, { files })
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
    await bootstrapContextFlow(page, { files })
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
    await bootstrapContextFlow(page, { files })
    await openFileInPreview(page, MD, NEEDLE)
    const { box } = await selectTextInPreview(page, NEEDLE)
    await rightClickSelection(page, box)
    await addToChatFromViewer(page)

    await expect(contextCards(page)).toHaveCount(1)
    expect((await contextCardSnapshots(page))[0]).toMatchObject({ path: MD, hasComment: false })
  })

  // R8-6 + R8-7:发送 → ↑ 翻历史 → 卡片原样回来 → 再加同一选区仍不重复
  test("round-trips a card through history without changing its identity", async ({ page }) => {
    await bootstrapContextFlow(page, { files })
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
    await bootstrapContextFlow(page, { files })
    await openFileInPreview(page, MD, NEEDLE)
    const { box } = await selectTextInPreview(page, NEEDLE)
    await rightClickSelection(page, box)
    await addToChatFromViewer(page, { comment: "to be removed" })
    await expect(contextCards(page)).toHaveCount(1)

    await removeContextCard(page)
    await expect(contextCards(page)).toHaveCount(0)
  })

  // R8-3:聊天区选中 → 右键 → 加入聊天(user 点名的「聊天区域选中文字」)
  // 聊天区走的是另一套菜单(context-menu-host),与预览区的 md-selection-menu 结构相同、slot 名不同。
  test("adds a chat quote card from a message selection", async ({ page }) => {
    await bootstrapContextFlow(page, {
      files,
      messages: [{ id: "msg_1", role: "user", text: `intro ${CHAT_QUOTE} outro` }],
    })
    const { text, box } = await selectTextInChat(page, CHAT_QUOTE)
    expect(text.trim().length).toBeGreaterThan(3)
    await rightClickSelection(page, box)
    await addToChatFromMenu(page, { comment: "about this reply" })

    await expect(contextCards(page)).toHaveCount(1)
    const [card] = await contextCardSnapshots(page)
    // 聊天引用是 kind=chat + 伪路径(core/util/chat-selection),不是真文件
    expect(card).toMatchObject({ kind: "chat", hasComment: true })
    expect(card.commentID).toMatch(/^quote-/)
  })

  // R8-4:@ 引用文件(user 点名的「引用某个文件」)
  test("mentions a file from the composer", async ({ page }) => {
    await bootstrapContextFlow(page, { files, mock: { findFiles: () => [MD] } })
    await mentionFile(page, MD)
    // @ 引用走 prompt 里的 file part,**不产生引用卡** —— 两条路径不得互相串
    await expect(contextCards(page)).toHaveCount(0)
  })

  // 第四轮发现 3 的 GUI 版:点历史找回的卡,不崩、不无故多开 tab
  test("clicking a restored card neither crashes nor opens a blank tab", async ({ page }) => {
    await bootstrapContextFlow(page, { files })
    await openFileInPreview(page, MD, NEEDLE)
    const { box } = await selectTextInPreview(page, NEEDLE)
    await rightClickSelection(page, box)
    await addToChatFromViewer(page, { comment: "click me" })
    await sendPrompt(page, "hello")
    await historyUp(page)
    await expect(contextCards(page)).toHaveCount(1)

    const tabsBefore = await page.getByRole("tab").count()
    await contextCards(page).first().click()
    await expect(page.locator('[data-component="error-page"]')).toHaveCount(0)
    expect(await page.getByRole("tab").count()).toBeLessThanOrEqual(tabsBefore + 1)
    const blank = await page.evaluate(
      () =>
        [...document.querySelectorAll("[role=tab]")].filter(
          (e) => e.getBoundingClientRect().height > 0 && !(e.textContent || "").trim(),
        ).length,
    )
    expect(blank).toBe(0)
  })

  // 「将所选内容添加到上下文」(⌘⇧L / context.addSelection)的**可用性闸**。
  //
  // 它不是死命令,是**条件命令**:`disabled: !canAddSelectionContext()`,而该判据要
  // `file.selectedLines(path) != null` —— 代码视图的行选区 UI 已于 2026-08-13 拿掉
  // (user 拍板「统一成右键加入聊天」,file-tabs.tsx renderDefault 的 FORK 注释),
  // 于是普通预览里它恒不可用;剩下能设这个状态的只有评审面板的行评论交互。
  //
  // 钉住现状的意义:防止有人看到「命令面板里搜不到」就去"修好"它 ——
  // 那等于把 2026-08-13 拿掉的交互复活。真要改,先回去看那次决策。
  test("the add-selection command stays gated without a line selection", async ({ page }) => {
    await bootstrapContextFlow(page, { files })
    await openFileInPreview(page, MD, NEEDLE)
    // 预览区里有**文本选区**,但没有 app 级行选区 —— 两者不是一回事
    await selectTextInPreview(page, NEEDLE)

    // 按它的快捷键:命令 disabled,不得产卡
    await page.keyboard.press("ControlOrMeta+Shift+KeyL")
    await expect(contextCards(page)).toHaveCount(0)

    // 反面对照:同一选区走右键路径**能**产卡 —— 证明前面的"没反应"是命令被门挡住,
    // 而不是选区本身没做出来(否则这条闸会变成一句废话)。
    const { box } = await selectTextInPreview(page, NEEDLE)
    await rightClickSelection(page, box)
    await addToChatFromMenu(page, { comment: "control" })
    await expect(contextCards(page)).toHaveCount(1)
  })

  // R8-11:浮层 Esc 取消 → 不落卡
  test("escaping the comment popover adds nothing", async ({ page }) => {
    await bootstrapContextFlow(page, { files })
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
