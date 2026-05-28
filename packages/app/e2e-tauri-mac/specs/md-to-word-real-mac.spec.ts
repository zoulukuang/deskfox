// [fork-only] md-to-word-real-mac.spec — Mac Phase 2 真桌面完整 .md → .docx 端到端
// [feat: e2e-tauri-phase2-mac] 2026-05-28
//
// **跟 Win 端 md-to-word-real.spec.ts 看齐** — 用例 / saveDialog 思路 / spec 流程一致,
// 底层差异:
// - Win: page.goto("http://tauri.localhost/<base64>") 注入项目目录(走 CDP)
// - Mac: open -a .app "opencode://open-project?directory=..."(deep_link,fixture 已注入)
// - Win: page.exposeFunction(saveDialog mock 方案 ①)
// - Mac: env DESKFOX_E2E_SAVE_PATH(saveDialog mock 方案 ② 降级)
// - Win: page.keyboard.press / page.locator
// - Mac: osascript keystroke + cliclick + Claude 视觉定位锚点
//
// 流程(基本对位 Win,5 phase):
//   1. fixture 已 spawn .app + 注入 opencode-fork 项目(deep_link)
//   2. clickToFront 标题保 frontmost
//   3. Cmd+K 打开命令面板 + type "CLAUDE.md" + Enter 打开文件
//   4. viewer 中部右键(cliclick rc)→ mdMenu 弹出
//   5. click "导出为 Word" 项(mdMenu 第 4 项 — 实证菜单顺序)
//   6. saveDialog 走 env mock → docx 落盘 e2eSavePath
//   7. 解压 word/document.xml 验段落 + 文本 run

import { test, expect } from "../fixtures"
import { existsSync, statSync, readFileSync, mkdirSync } from "node:fs"
import { unzipSync, strFromU8 } from "fflate"
import {
  keystrokeWithModifiers,
  typeUnicode,
  clickToFront,
  rightClick,
  titleBarAnchor,
  anchorOf,
  captureWindowArea,
  wait,
} from "../helpers"

const OUT_DIR = "/tmp/deskfox-e2e/md-to-word-real"

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true })
})

// **test.fixme** — 2026-05-28 实证:fixture deep_link 注入项目成功(opencode-fork 进项目视图),
// 但 Mac 项目主页跟 Win 端 page.goto 后视图行为不同 — Mac 进 "构建任何东西" 主页(底部 chat prompt
// 输入框 + Agent/Model 选择),**不是 session 内 file 搜索 view**。Cmd+K 在主页弹"新建会话"命令面板
// (而非"文件打开"),`type CLAUDE.md + Enter` 不能打开 .md viewer。
//
// 后续路径(2 选 1,留 backlog):
// 1. **改 deep_link 协议加 file 参数**:`opencode://open-project?directory=...&file=CLAUDE.md`,
//    layout.tsx handleDeepLinks 处理后 navigate 到 file viewer(等价 Win 进 session 内 + Ctrl+K)
// 2. **改 spec 走 file tree click**:截屏视觉定位 file tree 里的 CLAUDE.md 项,cliclick 直接点击
//    打开 viewer(这跟 Win 不完全同 user-flow,但 user-flow 仍是 "打开 .md → 右键 → 导出 Word")
//
// 当前已落地的 mac 化部分(纳入 commit):
// - fixture deep_link 注入项目(`opencode://open-project?directory=`)= Win page.goto 等价 ✓
// - clickToFront / titleBarAnchor / anchorOf helper 实证(visual locate + 物理点击)
// - mdMenu 右键菜单坐标算法(viewerCenter + (110, 130) 推 "导出 Word" 项 4 中心,留待实证)
test.fixme("md-to-word-real-mac — 完整端到端 .md → .docx(跟 Win 看齐)", async ({ deskfoxAppMac }) => {
  const { e2eSavePath } = deskfoxAppMac
  console.log(`[mac-e2e] saveDialog env mock 路径:${e2eSavePath}`)
  const ts = Date.now()

  // ---- Phase 0:验证项目视图(fixture deep_link 已注入,确认进项目目录)----
  const bounds = await deskfoxAppMac.windowBounds()
  await captureWindowArea(`${OUT_DIR}/p0-project-${ts}.png`, bounds)
  console.log(`[mac-e2e] phase 0: 项目视图 bounds=${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`)

  // ---- Phase 1:clickToFront 保 frontmost ----
  const titleAnchor = titleBarAnchor(bounds)
  await clickToFront(titleAnchor.x, titleAnchor.y)

  // ---- Phase 2:Cmd+K 命令面板 + 输 "CLAUDE.md" + Enter 打开文件 ----
  console.log(`[mac-e2e] phase 2: Cmd+K + 输 CLAUDE.md + Enter`)
  await keystrokeWithModifiers("k", ["command"])
  await wait(1000)
  await captureWindowArea(`${OUT_DIR}/p2a-cmdk-${ts}.png`, bounds)

  // 输文件名(ASCII 绕开 IME 转拼音)
  await typeUnicode("CLAUDE.md")
  await wait(1500) // fuzzy search 时间
  await captureWindowArea(`${OUT_DIR}/p2b-typed-${ts}.png`, bounds)

  // Enter 打开第一个匹配
  await keystrokeWithModifiers("return", [])
  await wait(3000) // 等 viewer hydrate 渲染 .md 内容
  await captureWindowArea(`${OUT_DIR}/p2c-opened-${ts}.png`, bounds)
  console.log(`[mac-e2e] ✓ CLAUDE.md 打开`)

  // ---- Phase 3:viewer 中部右键弹 mdMenu ----
  // 项目视图布局:左 file tree(~20%)+ 中 viewer(~50%)+ 右 panel(~30%)
  // viewer 中心约在窗口 logical 50% / 50%(避开顶 tab 栏 + 底状态栏)
  const viewerCenter = anchorOf(bounds, 0.5, 0.55)
  console.log(`[mac-e2e] phase 3: rightClick viewer center ${viewerCenter.x},${viewerCenter.y}`)
  await rightClick(viewerCenter.x, viewerCenter.y)
  await wait(1200)
  await captureWindowArea(`${OUT_DIR}/p3-rclick-${ts}.png`, bounds)

  // ---- Phase 4:click "导出为 Word" 菜单项 ----
  // mdMenu 菜单结构(file-tabs.tsx 实证 4 项 + 2 分隔线):
  //   [项 1] 加聊天(~32px)
  //   [项 2] 编辑(~32px)
  //   [分隔线 ~9px]
  //   [项 3] 复制(~32px)
  //   [分隔线 ~9px]
  //   [项 4] 导出为 Word(~32px)
  // 项 4 中心 y 偏移 ≈ 32+32+9+32+9 + 16 = ~130 px(项 4 中部)
  // 菜单弹在右键位置左下,左边界 ≈ rightClick.x,顶 ≈ rightClick.y(REQ-032 clamp 可能 reposition)
  // menu 宽 ~220px,项 4 中心 X 偏 ~110(中部)
  const exportItem = { x: viewerCenter.x + 110, y: viewerCenter.y + 130 }
  console.log(`[mac-e2e] phase 4: click 导出 Word ${exportItem.x},${exportItem.y}`)
  // 重要:不能用 osascript keystroke 切菜单(SolidJS DOM 菜单无 keyboard nav),必须 cliclick
  // 用 click(非 clickToFront)避免 wait,保留命令面板可见
  const { click } = await import("../helpers")
  await click(exportItem.x, exportItem.y)
  await wait(800)
  await captureWindowArea(`${OUT_DIR}/p4-export-clicked-${ts}.png`, bounds)

  // ---- Phase 5:等 docx 落盘(saveDialog mock 走 env path)----
  console.log(`[mac-e2e] phase 5: 等 docx at ${e2eSavePath}`)
  let waited = 0
  const maxWait = 20_000
  while (waited < maxWait) {
    if (existsSync(e2eSavePath)) break
    await wait(500)
    waited += 500
  }
  await wait(1500) // extra write buffer
  await captureWindowArea(`${OUT_DIR}/p5-after-export-${ts}.png`, bounds)

  // ---- Phase 6:验 docx 内容 ----
  expect(existsSync(e2eSavePath)).toBe(true)
  const stat = statSync(e2eSavePath)
  console.log(`[mac-e2e] docx size: ${stat.size} bytes`)
  expect(stat.size).toBeGreaterThan(2000)

  const docxBytes = new Uint8Array(readFileSync(e2eSavePath))
  const zip = unzipSync(docxBytes)
  expect("word/document.xml" in zip).toBe(true)
  expect("[Content_Types].xml" in zip).toBe(true)

  const docXml = strFromU8(zip["word/document.xml"]!)
  console.log(`[mac-e2e] document.xml: ${docXml.length} chars`)
  expect(docXml).toContain("<w:p")
  expect(docXml).toContain("<w:t")
  expect(docXml.length).toBeGreaterThan(500)

  console.log(`[mac-e2e] ✅ 完整端到端 MD → Word pass`)
  console.log(`     输出:${e2eSavePath}`)
  console.log(`     大小:${stat.size} bytes`)
})
