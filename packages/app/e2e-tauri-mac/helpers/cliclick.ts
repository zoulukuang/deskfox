// [fork-only] e2e-tauri-mac/helpers/cliclick — cliclick 命令封装
// [feat: e2e-tauri-phase2-mac] 2026-05-28
//
// cliclick 是 macOS 鼠标 / 键盘模拟工具 — brew install cliclick(已验装于本机)。
// 局限:
// - 修饰键(Cmd / Option 等)不可靠 — memory `reference_deskfox_gui_automation.md` §8 实测踩过坑;
//   组合键改走 osascript.ts keystrokeWithModifiers,本文件只做无修饰键操作。
// - 坐标系:全屏绝对坐标,左上原点;Retina 显示器自动按 logical resolution 换算(无须额外处理)。

import { exec } from "node:child_process"
import { promisify } from "node:util"

const execP = promisify(exec)

// 默认走 PATH 解析(exec 继承父 process.env 含 PATH),user 在 shell / Terminal 跑测试时
// homebrew 路径已在 PATH 里。CI / 非交互场景如果 PATH 不全可设 CLICLICK_PATH env 显式指定。
const CLICLICK = process.env.CLICLICK_PATH || "cliclick"

async function runCliclick(args: string[]): Promise<void> {
  const cmd = `${CLICLICK} ${args.join(" ")}`
  try {
    await execP(cmd, { timeout: 5_000 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `cliclick 执行失败:${msg}\n命令:${cmd}\n` +
        `(没装?brew install cliclick;或 PATH 缺 homebrew → 设 CLICLICK_PATH env 指定绝对路径)`,
    )
  }
}

/** 单击 (x, y) — 绝对屏幕坐标 */
export async function click(x: number, y: number): Promise<void> {
  await runCliclick([`c:${x},${y}`])
}

/** 右键单击 (x, y) */
export async function rightClick(x: number, y: number): Promise<void> {
  await runCliclick([`rc:${x},${y}`])
}

/** 双击 (x, y) */
export async function doubleClick(x: number, y: number): Promise<void> {
  await runCliclick([`dc:${x},${y}`])
}

/** 移动鼠标到 (x, y) 不点击 */
export async function moveTo(x: number, y: number): Promise<void> {
  await runCliclick([`m:${x},${y}`])
}

/** 按一个键(无修饰键)— 修饰键组合走 osascript.ts keystrokeWithModifiers */
export async function keyPress(key: CliclickKey): Promise<void> {
  await runCliclick([`kp:${key}`])
}

/**
 * 打字 — **仅推荐 ASCII**。中文 / emoji **必须**走 osascript.ts `runAppleScript(keystroke ...)`,
 * cliclick t: 实测对非 ASCII 输入直接吞掉(memory `reference_deskfox_gui_automation.md` §8)。
 *
 * 跟 osascript 版的差异:
 * - cliclick t: 速度快(适合长串 ASCII),但 unicode 不可靠
 * - osascript keystroke 慢(每字符 ~50ms 调一次 osascript)但 unicode 稳
 */
export async function type(text: string): Promise<void> {
  // ASCII 之外的字符 cliclick 实测吞掉 — 显式拦截避免静默失败
  if (!/^[\x20-\x7e]*$/.test(text)) {
    throw new Error(
      `cliclick.type() 仅支持 ASCII,got non-ASCII: ${JSON.stringify(text)}\n` +
        `非 ASCII 输入走 osascript.ts: runAppleScript(\`tell application "System Events" to keystroke ${JSON.stringify(text)}\`)`,
    )
  }
  await runCliclick([`t:${JSON.stringify(text)}`])
}

/** 链式等待(ms)— 链式操作时插入等待让 GUI 跟上 */
export async function wait(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/**
 * 物理点击 (x, y) 让指定 .app 真 frontmost(等价 user 拖窗口标题获取焦点)。
 *
 * **关键工具** — macOS Sequoia 下 `osascript activate` 异步事件可能没真生效就被
 * 后续 keystroke 截获到 frontmost 的其他 app(Terminal / IDE 等)。物理 cliclick
 * 是**强制 frontmost**的最稳路径,实测 100% work(2026-05-28 实证)。
 *
 * 推荐配套 `helpers/window-bounds.titleBarAnchor()`:点击窗口标题栏空白区,
 * 不触发任何 .app UI 元素。
 *
 * @example
 *   const bounds = await getWindowBounds("DeskFox Dev")
 *   const anchor = titleBarAnchor(bounds)
 *   await clickToFront(anchor.x, anchor.y)
 *   // 现在 DeskFox Dev 真 frontmost,可以稳定 keystroke
 */
export async function clickToFront(x: number, y: number): Promise<void> {
  await click(x, y)
  // 给 macOS 时间真的处理点击事件 + 切换 frontmost
  await new Promise((r) => setTimeout(r, 500))
}

/** cliclick 支持的键名(节选,加按需扩) */
export type CliclickKey =
  | "return"
  | "enter"
  | "tab"
  | "space"
  | "esc"
  | "delete"
  | "arrow-up"
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "page-up"
  | "page-down"
  | "home"
  | "end"
