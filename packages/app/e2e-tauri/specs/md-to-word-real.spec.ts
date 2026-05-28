// FORK: 真实端到端 MD → Word — 完整用户路径(全程自动化)2026-05-07
//
// ⚠ 当前 fixme — saveDialog mock 方案待实施(详见 e2e-tauri/README.md "saveDialog mock 路径")
//
// 此 spec 之前用 packages/desktop/src/index.tsx 的 4 行产品代码 hook 实现 mock,
// 2026-05-08 user 决议剔除产品侵入,本 spec 暂时 fixme 不跑;
// 等清洁 mock 方案落地(Playwright `page.exposeFunction` / env var 检测 / Tauri Rust mock)
// 后再去掉 fixme 启用。
//
// 流程(mock 落地后能跑):
//   1. spawn DeskFox.exe(remote-debugging-port=9222)
//   2. CDP 连接 + 等 hydrate + SetForegroundWindow + 注入 e2e save mock
//   3. 在文件树找任意 .md → click → 触发 viewer 渲染
//   4. viewer 上右键 → 触发 mdMenu
//   5. 点"导出为 Word" → exportMdAsDocx 走 platform.saveFilePickerDialog
//   6. e2e hook 让 saveDialog 直接返 mock 路径(不弹 native dialog)
//   7. 真实 invoke write_binary_file_absolute_base64 写盘
//   8. 验证 docx 落盘 + 解压 word/document.xml 检查内容
//
// 实证记录:2026-05-07 这套跑通过 1 次,生成了 53KB 的 real-export-1778164184821.docx,
// 测试 status: passed。但 docx 视觉效果 user 反馈"不理想",独立 backlog 处理。

import { existsSync, statSync, readFileSync, mkdirSync } from "node:fs"
import { unzipSync, strFromU8 } from "fflate"
import { test, expect } from "../fixtures"

const OUTPUT_DIR = "D:/tmp/deskfox-test-output"

test.beforeAll(() => {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true })
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test("完整端到端 — 真启动 DeskFox + 找 .md + 右键导出 + 验证 docx", async ({ deskfoxApp }) => {
  const { page, e2eSavePath } = deskfoxApp

  console.log(`[e2e] 输出路径(e2e mock):${e2eSavePath}`)

  // ---- Phase 1/2: 用 Ctrl+K 命令面板搜文件,打开 CLAUDE.md(opencode-fork 根稳定 .md)----
  // 比 click 文件树稳:① 不依赖 file-tree 是否展开;② 不依赖文件树 SolidJS 结构是否变
  console.log(`[e2e] phase 1/2: open Ctrl+K command palette + type CLAUDE.md + Enter`)
  await page.screenshot({ path: "e2e-tauri/test-results/p1-startup.png", fullPage: true })

  // Ctrl+K → 文件搜索(DeskFox 在项目页常驻支持)
  await page.keyboard.press("Control+k")
  await sleep(800)
  // 输文件名(逐字符,触发 SolidJS reactive)
  for (const ch of "CLAUDE.md") {
    await page.keyboard.type(ch)
    await sleep(40)
  }
  await sleep(1200) // 等 fuzzy search 出结果
  await page.screenshot({ path: "e2e-tauri/test-results/p2-cmdk.png", fullPage: true })

  // 回车选第一项(默认应该是 CLAUDE.md 在根的精确匹配)
  await page.keyboard.press("Enter")
  await sleep(2500)
  const chosenName = "CLAUDE.md"
  console.log(`[e2e] opened via Ctrl+K: ${chosenName}`)
  await page.screenshot({ path: "e2e-tauri/test-results/p2b-after-open.png", fullPage: true })

  // 等 viewer 出现(data-context="file-viewer" 是 fork 在 markdown 渲染容器加的标记)
  const viewer = page.locator('[data-context="file-viewer"]').first()
  await viewer.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
    console.log(`[e2e] WARN: file-viewer 未在 10s 内可见(可能 UI 结构不同)`)
  })

  // ---- Phase 3: viewer 上右键 ----
  console.log(`[e2e] phase 3: right-click on viewer`)
  const viewerVisible = await viewer.isVisible().catch(() => false)
  if (viewerVisible) {
    await viewer.click({ button: "right" })
  } else {
    // fallback:直接在主区域中部右键
    const box = await page.viewportSize()
    if (box) {
      await page.mouse.click(box.width * 0.6, box.height * 0.5, { button: "right" })
    }
  }
  await sleep(800)
  await page.screenshot({ path: "e2e-tauri/test-results/p3-right-click.png", fullPage: true })

  // ---- Phase 4: 找"导出为 Word"菜单项 + click ----
  console.log(`[e2e] phase 4: locate '导出为 Word' menu item`)
  // mdMenu Portal 渲到 document.body,data-slot="md-selection-menu"
  const exportItem = page
    .locator('[data-slot="md-selection-menu"] button')
    .filter({ hasText: /导出.*Word|Export.*Word|匯出.*Word/ })
    .first()
  await exportItem.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {
    console.log(`[e2e] WARN: 导出菜单项未在 5s 内可见`)
  })
  const exportVisible = await exportItem.isVisible().catch(() => false)
  console.log(`[e2e] export menu item visible: ${exportVisible}`)

  if (!exportVisible) {
    // dump menu state
    const menus = page.locator('[data-slot="md-selection-menu"]')
    const menuCount = await menus.count()
    console.log(`[e2e] md-selection-menu count: ${menuCount}`)
    if (menuCount > 0) {
      const menuText = await menus.first().innerText()
      console.log(`[e2e] menu content:\n${menuText}`)
    }
    throw new Error("Export Word menu item not visible")
  }

  await exportItem.click()
  console.log(`[e2e] phase 4: clicked export — saveDialog 走 e2e mock,docx 生成中`)

  // ---- Phase 5: 等 docx 落盘 ----
  console.log(`[e2e] phase 5: wait for docx file to land at ${e2eSavePath}`)
  let waited = 0
  const maxWait = 15_000
  while (waited < maxWait) {
    if (existsSync(e2eSavePath)) break
    await sleep(500)
    waited += 500
  }
  await sleep(1500) // extra buffer for write completion
  await page.screenshot({ path: "e2e-tauri/test-results/p5-after-export.png", fullPage: true })

  // ---- Phase 6: 验证 docx ----
  console.log(`[e2e] phase 6: verify docx`)
  expect(existsSync(e2eSavePath)).toBe(true)
  const docxStat = statSync(e2eSavePath)
  console.log(`[e2e] docx size: ${docxStat.size} bytes`)
  expect(docxStat.size).toBeGreaterThan(2000)

  // 解压验证 word/document.xml
  const docxBytes = new Uint8Array(readFileSync(e2eSavePath))
  const zipObj = unzipSync(docxBytes)
  expect("word/document.xml" in zipObj).toBe(true)
  expect("[Content_Types].xml" in zipObj).toBe(true)

  const docXml = strFromU8(zipObj["word/document.xml"]!)
  console.log(`[e2e] document.xml: ${docXml.length} chars`)

  // docx 至少有段落 + 文本 run
  expect(docXml).toContain("<w:p")
  expect(docXml).toContain("<w:t")
  expect(docXml.length).toBeGreaterThan(500)

  console.log(`[e2e] ✅ 完整端到端 MD → Word pass`)
  console.log(`     Source .md: "${chosenName}"`)
  console.log(`     Output:     ${e2eSavePath}`)
  console.log(`     Size:       ${docxStat.size} bytes`)
})
