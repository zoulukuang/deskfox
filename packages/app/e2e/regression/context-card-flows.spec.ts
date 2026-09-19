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
    expect(text).toContain(NEEDLE)
    await rightClickSelection(page, box)
    await addToChatFromViewer(page, { comment: "why this line" })

    await expect(contextCards(page)).toHaveCount(1)
    expect(await contextCardSnapshots(page)).toEqual([
      {
        path: MD,
        hasComment: true,
        commentID: expect.stringMatching(/^md-sel-/),
        kind: "file",
        // 行号标签必须真的有 —— selection 退化成 undefined 时这里会红(review finding 7)
        selectionLabel: expect.stringMatching(/^:\d+(-\d+)?$/),
      },
    ])
  })

  // R8-2:同上但是 .txt —— 内容在 <diffs-container> 的 shadow DOM 里,钉住那条路
  test("adds a card from a shadow-DOM (text file) selection", async ({ page }) => {
    await bootstrapContextFlow(page, { files })
    await openFileInPreview(page, TXT, NEEDLE)
    const { text, box } = await selectTextInPreview(page, NEEDLE)
    expect(text).toContain(NEEDLE)
    await rightClickSelection(page, box)
    await addToChatFromViewer(page, { comment: "shadow path" })

    await expect(contextCards(page)).toHaveCount(1)
    expect((await contextCardSnapshots(page))[0]).toMatchObject({ path: TXT, hasComment: true })
  })

  // R8-8:不填注释也必须落卡且可见(经典布局)。
  //
  // ⚠️ 2026-09-19 review 订正:本条**不守**上游 `interaction.ts` 那两处判据 ——
  // 那是 v2 composer,而本套件写死经典布局(legacy `PromptContextItems` 从不按注释筛卡),
  // 把那两处退回本条照样绿(实测)。v2 判据由
  // `session-ui/.../interaction-context-predicates.test.ts` 单测守。
  // 本条真正守的是:经典布局下「不填注释直接提交」这条用户路径能落卡、且卡片可见。
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
    // 往返恒等:逐字段相同(含行号标签 —— selection 退化成 undefined 也会在这里红)。
    // ⚠️ 2026-09-19 review 订正:本条**不守**第四轮 ① 的伪 commentID 回归(GUI 卡恒带 md-sel-*,
    // fallback 不触发,退回修复本条照绿 —— 已实测)。它守的是「往返映射不丢字段」,
    // 变异验证过:把 historyCommentToContextItem 的 commentID 改成 undefined,本条立刻红。
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
    expect(text).toContain(CHAT_QUOTE)
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
    // 正面断言:编辑器里真的出现了 file mention 节点。
    // 2026-09-19 review 补:原先只有「没有引用卡」这条**缺席断言** ——
    // 若 @ 引用退化成只插一段纯文本(文件压根没发给模型),本条照样绿。
    // 经典编辑器的 mention pill 属性是 `data-type`(prompt-input.tsx:847 `pill.setAttribute("data-type", part.type)`);
    // `data-mention` 是 v2 编辑器的写法 —— 第一版写错了,强断言当场把它抓了出来。
    await expect(page.locator('[data-component="prompt-input"] [data-type="file"]').first()).toBeVisible()
    // 再断言它**不产生引用卡** —— 两条路径不得互相串
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
    // 「不多开 tab」就该是**不多开**:原先写 +1 等于把这半句断言放空了
    expect(await page.getByRole("tab").count()).toBe(tabsBefore)
    const blank = await page.evaluate(
      () =>
        [...document.querySelectorAll("[role=tab]")].filter(
          (e) => e.getBoundingClientRect().height > 0 && !(e.textContent || "").trim(),
        ).length,
    )
    expect(blank).toBe(0)
  })

  // 「将所选内容添加到上下文」(⌘⇧L / context.addSelection)的**行为闸**。
  //
  // ⚠️ 2026-09-19 review 订正:本条**守不住** `use-session-commands.tsx` 那行
  // `disabled: !canAddSelectionContext()` —— 因为 `addSelection()` 自己还有第二道守卫
  // (`if (!range) { showToast(...); return }`),把 `disabled:` 删掉本条照样绿。
  //
  // 它真正守的是**现状本身**:普通预览区里有文本选区、但没有 app 级行选区时,
  // 这个入口产不出卡。代码视图的行选区 UI 已于 2026-08-13 拿掉(user 拍板「统一成右键加入聊天」),
  // 所以这是当前设计的一部分,不是 bug。留着是为了:若哪天有人复活那套交互,
  // 这条会红,提醒他回去看 2026-08-13 那次决策。
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
