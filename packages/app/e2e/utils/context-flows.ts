// FORK-ONLY e2e 工具:引用/选区核心流程的自动化驱动。
// [feat: e2e-context-flow-harness] 2026-09-19
//
// 为什么需要它:2026-09-19 第四轮 code-review 的三条修复里,两条在 GUI 里根本驱动不了,
// 只能靠单测兜。user 要求把「引用文件 / 预览区或聊天区选中文字 → 右键 → 加入聊天」
// 这类核心操作打通全自动化 —— 本文件就是那层驱动。
//
// ## 封装了哪些踩坑(尖刺实测,别绕过这些 helper 自己写)
//
// 1. **预览内容可能在 shadow DOM 里**:`.md` 走 light DOM,`.txt`/代码类走 `<diffs-container>`
//    的 shadow root。Playwright 的 locator 默认穿 open shadow root(所以 `getByText` 能用),
//    但 `page.evaluate` 里手写 `TreeWalker` **不穿** —— 第一版尖刺就栽在这。
// 2. **选区必须用真鼠标拖**:产品读选区的链路是
//    `mousedown → collectShadowFromEvent 收集 shadow root → ShadowRoot.getSelection()`
//    (`selection-history.ts` 三级策略)。程序化 `Range + addRange` 时产品的 `knownShadows`
//    是空的,读不到选区 → 右键菜单直接不弹。
// 3. **右键浮层是两步**:菜单项「加入聊天」只是打开输入浮层,要再提交一次才真落卡。
//    菜单项与浮层提交按钮**同名**(`fileViewer.menu.addToChat` / `.input.submit` 都是
//    "Add to Chat"),靠 `.first()/.last()` 区分极脆 —— 一律用 `data-slot="md-selection-menu"`
//    把作用域收到浮层内部。
// 4. **只服务 DeskFox 当前布局(经典布局)**:`settings.general.newLayoutDesigns=false`,
//    即 legacy `PromptInput` + 左侧栏文件树(`[data-component="filetree"]`)+
//    `[data-component="prompt-agent-control"]` 那套。user 2026-09-19 拍板「以后只用这种布局」,
//    工具不再兼容 v2 composer —— 少一个维度,少一处错。
// 6. **就绪信号必须与布局无关**:`waits.ts` 的 `expectSessionTitle` 找的是 `role=heading`,
//    而经典布局的会话标题**不是 heading** —— 第一版用它,整组用例卡在 bootstrap,
//    报错却只说「找不到 heading」,极易误读成"会话没打开"。这里等输入区 dock。
// 5. **不要 waitForTimeout**(e2e/AGENTS.md 硬规):每个动作等它自己那一步的可观察状态。

import { expect, type Locator, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { assistantMessage, userMessage } from "./fixtures"
import { mockOpenCodeServer, type MockServerConfig } from "./mock-server"

const T0 = 1_700_000_000_000

export type ContextFlowFile = { name: string; content: string }

export type BootstrapOptions = {
  /** 文件树里放哪些文件(名字即相对路径,内容按名字返回) */
  files: ContextFlowFile[]
  directory?: string
  sessionTitle?: string
  /** 预置到会话里的消息(给「聊天区选区」这类用例用);不传则空会话 */
  messages?: { id: string; role: "user" | "assistant"; text: string }[]
  /** 直接透传给 mock-server 的额外配置(如 findFiles / vcsDiff) */
  mock?: Partial<MockServerConfig>
}

export type BootstrapResult = {
  directory: string
  sessionID: string
  title: string
}

/** 输入区里的引用卡(两套 composer 共用契约) */
export type ContextCardSnapshot = {
  path: string
  hasComment: boolean
  commentID: string | null
  kind: string
}

const SERVER = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

/** 拼 mock + localStorage + goto,停在「会话已打开」这个可断言状态上。 */
export async function bootstrapContextFlow(page: Page, options: BootstrapOptions): Promise<BootstrapResult> {
  const directory = options.directory ?? "C:/OpenCode/ContextFlows"
  const projectID = "proj_context_flows"
  const sessionID = "ses_context_flows"
  const title = options.sessionTitle ?? "Context flows"
  const byName = new Map(options.files.map((file) => [file.name, file.content]))

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "context-flows",
      time: { created: T0, updated: T0 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: T0, updated: T0 },
      },
    ],
    vcsDiff: [],
    fileList: (path) =>
      path
        ? []
        : options.files.map((file) => ({
            name: file.name,
            path: file.name,
            absolute: `${directory}/${file.name}`,
            type: "file" as const,
            ignored: false,
          })),
    fileContent: (path) => ({ type: "text", content: byName.get(path.replace(/\\/g, "/")) ?? "" }),
    // 用仓里现成的 fixtures builder,不手搓消息结构(手搓的第一版 rows=0,渲染不出来)
    pageMessages: () => ({
      items: (options.messages ?? []).map((message, index) =>
        message.role === "user"
          ? userMessage({ id: message.id, sessionID, text: message.text })
          : assistantMessage({
              id: message.id,
              sessionID,
              // assistant 消息必须挂在**真实存在**的 user 消息上:parentID 悬空时整条不渲染
              // (实测 rows=0,且没有任何报错)。所以这里只认前面最近的一条 user 消息。
              parentID: (() => {
                const parent = (options.messages ?? [])
                  .slice(0, index)
                  .reverse()
                  .find((m) => m.role === "user")
                if (!parent) {
                  throw new Error(
                    `bootstrapContextFlow: assistant 消息 "${message.id}" 前面没有 user 消息 —— parentID 会悬空,整条不渲染`,
                  )
                }
                return parent.id
              })(),
              parts: [{ id: `${message.id}_text`, type: "text", text: message.text }],
            }),
      ),
    }),
    ...options.mock,
  })

  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      localStorage.setItem(
        "settings.v3",
        // 经典布局:DeskFox 唯一在用的布局(user 2026-09-19 拍板)
        JSON.stringify({ general: { newLayoutDesigns: false, shouldDisplayTabsToast: false } }),
      )
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.global.dat:layout",
        JSON.stringify({ review: { diffStyle: "split", panelOpened: true } }),
      )
      localStorage.setItem(
        "opencode.global.dat:review-panel-v2",
        JSON.stringify({ sidebarOpened: true, sidebarWidth: 240, expandMode: "collapse" }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
      )
    },
    { directory, server: SERVER, sessionID },
  )

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  // 就绪信号必须与布局无关:`expectSessionTitle` 找的是 role=heading,
  // **经典布局的会话标题不是 heading** —— 第一版用它,整组经典布局用例全部卡在 bootstrap,
  // 而报错只说「找不到 heading」,极易被误读成"会话没打开"。改等输入区 dock(两套布局都有)。
  await expect(page.locator('[data-component="session-prompt-dock"]')).toBeVisible({ timeout: 30_000 })
  return { directory, sessionID, title }
}

/**
 * 左侧栏文件树 → 打开文件预览,停在「内容已可见」。
 *
 * 经典布局的文件树在 `[data-component="filetree"]` 里,行上**没有任何 data-***,
 * 只能按文件名文本点(scope 到树容器内,避免撞到 tab 标题或会话列表里的同名文本)。
 * 左侧栏有「所有文件 / N 更改」两个 tab,先确保停在「所有文件」。
 */
export async function openFileInPreview(page: Page, name: string, needle: string) {
  const allFilesTab = page.getByRole("tab", { name: "All files" })
  if (await allFilesTab.isVisible().catch(() => false)) await allFilesTab.click()

  const row = page.locator('[data-component="filetree"]').getByText(name, { exact: true }).first()
  await expect(row).toBeVisible()
  await row.click()

  await expect(page.getByRole("tab", { name }).first()).toHaveAttribute("data-selected", "")
  // getByText 穿 open shadow root —— 代码类文件的内容在 <diffs-container> 的 shadow 里
  const text = viewerText(page, needle)
  await expect(text).toBeVisible()
  return text
}

// 不 scope 到 #review-panel:经典布局下预览不一定挂在评审面板内。
const viewerText = (page: Page, needle: string) =>
  page.locator('[data-component="file-viewer"]').getByText(needle, { exact: false }).first()

/**
 * 真鼠标拖选预览区的一段文本。返回产品实际读到的选区文本(shadow / light 都覆盖),
 * 断言它非空就等于「产品能看见这个选区」—— 右键菜单可弹的前置。
 */
export async function selectTextInPreview(page: Page, needle: string) {
  const target = viewerText(page, needle)
  await expect(target).toBeVisible()
  const box = await target.boundingBox()
  if (!box) throw new Error(`selectTextInPreview: 拿不到 "${needle}" 的 boundingBox`)
  const y = box.y + box.height / 2

  // 先按用户最常见的动作拖选;拖选对 padding / 行内换行敏感,失败就退到三击整段选中
  // (也是真实用户动作,且对布局不敏感)。两者都走真鼠标事件 —— 产品只认这一种。
  await page.mouse.move(box.x + 4, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.55, y, { steps: 10 })
  await page.mouse.up()
  let selected = await readProductSelection(page)
  if (!selected.trim()) {
    await target.click({ clickCount: 3 })
    selected = await readProductSelection(page)
  }
  return { text: selected, box }
}

/** 按产品 selection-history.ts 的同一套策略读选区:先问各 shadow root,再问 document。 */
async function readProductSelection(page: Page) {
  return page.evaluate(async () => {
    const read = () => {
      const roots = [...document.querySelectorAll("*")]
        .map((el) => (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot)
        .filter((root): root is ShadowRoot => !!root)
      for (const root of roots) {
        const sel = (root as unknown as { getSelection?: () => Selection | null }).getSelection?.()
        if (sel && sel.toString().trim()) return sel.toString()
      }
      const win = window.getSelection()
      return win ? win.toString() : ""
    }
    // 选区是同步状态,但 shadow 宿主的 getSelection 在 mouseup 后可能晚一帧可见
    for (let i = 0; i < 10; i++) {
      const value = read()
      if (value.trim()) return value
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    }
    return read()
  })
}

/**
 * 选区右键菜单有两个来源,结构相同、slot 名不同:
 *   · 文件预览区 → `[data-slot="md-selection-menu"]`(file-tabs.tsx)
 *   · 聊天区     → `[data-slot="context-menu-host"]`(utils/context-menu-host/host.tsx)
 * 两者都是「菜单项 Add to Chat → 输入浮层 → 提交」两步,且两个按钮同名。
 */
const MENU_SLOTS = '[data-slot="md-selection-menu"], [data-slot="context-menu-host"]'

/** 在刚选中的位置右键,停在「菜单已弹出」。 */
export async function rightClickSelection(page: Page, box: { x: number; y: number; width: number; height: number }) {
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2)
  await page.mouse.down({ button: "right" })
  await page.mouse.up({ button: "right" })
  const menu = page.locator(MENU_SLOTS).first()
  await expect(menu).toBeVisible()
  return menu
}

/**
 * 菜单「加入聊天」→ 输入浮层 → 提交。预览区与聊天区共用。
 *
 * `comment` 留空即「不填注释直接加」。提交手势用 Enter(与点按钮等价,2×2 实测一致),
 * 因为浮层的提交按钮与菜单项同名,键盘路径可读性更好。
 */
export async function addToChatFromMenu(page: Page, options: { comment?: string } = {}) {
  const menu = page.locator(MENU_SLOTS).first()
  await menu.getByRole("button", { name: "Add to Chat" }).click()
  const textarea = menu.locator("textarea")
  await expect(textarea).toBeVisible()
  if (options.comment) await textarea.fill(options.comment)
  await textarea.press("Enter")
  await expect(menu).toBeHidden()
}

/** 预览区专用别名(语义更直白;实现与聊天区共用)。 */
export const addToChatFromViewer = addToChatFromMenu

/** 输入区所有引用卡的身份快照(两套 composer 共用 `[data-context-card]` 契约)。 */
export function contextCards(page: Page): Locator {
  return page.locator("[data-context-card]")
}

export async function contextCardSnapshots(page: Page): Promise<ContextCardSnapshot[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-context-card]")].map((el) => ({
      path: el.getAttribute("data-path") ?? "",
      hasComment: el.getAttribute("data-has-comment") === "true",
      commentID: el.getAttribute("data-comment-id"),
      kind: el.getAttribute("data-kind") ?? "file",
    })),
  )
}

/** 删掉第 index 张卡(卡片右上角 ✕;legacy 与 v2 的 aria-label 不同,两个都试)。 */
export async function removeContextCard(page: Page, index = 0) {
  const card = contextCards(page).nth(index)
  await card.hover()
  await card.locator("button").last().click()
}

const composerEditor = (page: Page) => page.locator('[data-component="prompt-input"][contenteditable]').first()

/** 往输入框打字(不发送)。 */
export async function typeInComposer(page: Page, text: string) {
  const editor = composerEditor(page)
  await editor.click()
  await page.keyboard.type(text)
}

/**
 * 发送当前输入框内容,停在「卡片已被清空」——
 * 这是 submit 走完的可观察信号(history.add 发生在网络请求之前,所以历史一定已写入)。
 */
export async function sendPrompt(page: Page, text: string) {
  await typeInComposer(page, text)
  await composerEditor(page).press("Enter")
  await expect(contextCards(page)).toHaveCount(0)
}

/** ↑ 翻历史(回到上一条)。 */
export async function historyUp(page: Page) {
  const editor = composerEditor(page)
  await editor.click()
  await editor.press("ArrowUp")
}

/** ↓ 翻历史。 */
export async function historyDown(page: Page) {
  const editor = composerEditor(page)
  await editor.click()
  await editor.press("ArrowDown")
}

/**
 * @ 引用文件:输入 `@` + 文件名,从建议列表选中。
 *
 * 建议列表**没有 role=option / role=listbox**(实测),项就是带文件路径文本的普通按钮 ——
 * 所以只能按文本点;scope 不能放宽到全页,否则会撞到左侧文件树里的同名行。
 */
export async function mentionFile(page: Page, name: string) {
  const editor = composerEditor(page)
  await editor.click()
  await page.keyboard.type(`@${name}`)
  const option = page
    .locator("button, li")
    .filter({ hasText: new RegExp(`^/?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
    .first()
  await expect(option).toBeVisible()
  await option.click()
  await expect(editor).toContainText(name)
}

/**
 * 聊天区(消息气泡)里选中一段文字。
 *
 * 与预览区同一套机制(真鼠标拖选 → 产品从 selection 读),差别只在 scope:
 * 消息行锚点是 `[data-message-id]`(见 session.tsx / find/dom-highlight.ts),
 * 不 scope 会撞到右侧会话列表里的同名标题文本。
 */
export async function selectTextInChat(page: Page, needle: string) {
  const target = page.locator("[data-message-id]").getByText(needle, { exact: false }).first()
  await expect(target).toBeVisible()
  const box = await target.boundingBox()
  if (!box) throw new Error(`selectTextInChat: 拿不到 "${needle}" 的 boundingBox`)
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 4, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 10 })
  await page.mouse.up()
  let selected = await readProductSelection(page)
  if (!selected.trim()) {
    await target.click({ clickCount: 3 })
    selected = await readProductSelection(page)
  }
  return { text: selected, box }
}
