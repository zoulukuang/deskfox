// [fork-only] e2e-tauri-mac/helpers/osascript — AppleScript 执行封装
// [feat: e2e-tauri-phase2-mac] 2026-05-28
//
// Mac 端 Phase 2 真桌面 e2e 走 GUI 黑盒(不连 WebView CDP),osascript 是基础设施:
// - app 拉前景 / 退出
// - 组合键模拟(Cmd+K 等,cliclick 在修饰键上有限制 — 详 memory reference_deskfox_gui_automation.md §8)
// - 窗口位置查询(cliclick 点击需要绝对坐标,先查 frontmost window bounds)
// - 菜单项点击(file menu / context menu,osascript 直接 click menu item by name)
//
// 跟 Win 端 fixture 的 PowerShell `[Win32]::SetForegroundWindow` 对位置不同 — Win 用 Win32 API,
// Mac 用 AppleScript System Events 桥,功能等价。

import { exec } from "node:child_process"
import { promisify } from "node:util"

const execP = promisify(exec)

/**
 * 跑 AppleScript,失败抛错(包含完整 stderr)。timeout 默认 10s。
 */
export async function runAppleScript(script: string, timeoutMs = 10_000): Promise<string> {
  // -e 模式:每行一个 -e,避免 shell quoting 反斜杠地狱
  const lines = script.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  const args = lines.map((l) => `-e ${JSON.stringify(l)}`).join(" ")
  try {
    const { stdout } = await execP(`osascript ${args}`, { timeout: timeoutMs })
    return stdout.trim()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`osascript failed: ${msg}\n--- script ---\n${script}`)
  }
}

/**
 * 把 app 拉到前景(对应 Win 端 SetForegroundWindow)。
 * appName 用 CFBundleName(dev = "DeskFox Dev",prod = "DeskFox")。
 *
 * ⚠️ **实测不可靠**(macOS Sequoia,2026-05-28):osascript activate 是异步事件,可能
 * 没真生效就 keystroke,导致 keystroke 打到 Terminal/IDE 等 frontmost app。
 * 真要 frontmost 必须用 `cliclickToFront`(物理点击窗口标题强制激活)。
 * 保留本函数兼容,但**所有需要 frontmost 才能 keystroke 的场景请用 cliclickToFront**。
 */
export async function activateApp(appName: string): Promise<void> {
  await runAppleScript(`tell application "${appName}" to activate`)
}

/**
 * 优雅退出 app(fixture teardown 优先用,fallback SIGKILL)。
 * 跟 activateApp 一样按 CFBundleName。
 */
export async function quitApp(appName: string): Promise<void> {
  await runAppleScript(`tell application "${appName}" to quit`)
}

/**
 * 查 app 是否在跑 — 通过 System Events 进程枚举。
 * processName 是 binary basename(默认 "DeskFox",对应 mainBinaryName);
 * 跟 CFBundleName 在 dev/prod 同名,不能区分 channel,**仅用于 launch 等待**。
 */
export async function isProcessRunning(processName: string): Promise<boolean> {
  const result = await runAppleScript(
    `tell application "System Events" to (count (every process whose name is "${processName}")) > 0`,
  ).catch(() => "false")
  return result === "true"
}

/**
 * 等 .app launch 完成(进程出现在 System Events 列表 + 至少 1 个 visible window)。
 * 默认 30s 超时。
 */
export async function waitForAppLaunch(
  appName: string,
  processName = "DeskFox",
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const running = await isProcessRunning(processName)
    if (running) {
      // 进一步等 window 出来(splash → main UI 过渡 ~1-2s)
      try {
        await getWindowBounds(appName)
        return
      } catch {
        // window 还没出,继续等
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`waitForAppLaunch(${appName}) timeout after ${timeoutMs}ms`)
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 查 frontmost window 位置 + 尺寸(绝对屏幕坐标,左上原点)。
 * cliclick 点击需要这个 — 窗口可能被 user 移动,每次操作前重查最稳。
 *
 * 注:依赖辅助功能权限(System Settings → 隐私与安全 → 辅助功能 → 给终端 / playwright 授权)。
 * 首次跑会弹权限对话框,user 授权后才生效。
 */
export async function getWindowBounds(appName: string): Promise<WindowBounds> {
  // 用 System Events tell process by name(name 是 binary basename "DeskFox" / "DeskFox Dev" 不匹配)
  // 但 application "DeskFox Dev" 命中 .app(CFBundleName),处理两层桥接:
  // tell application "DeskFox Dev" → 让它 frontmost → 再 tell System Events 查 process "DeskFox" position
  const script = `
tell application "${appName}" to activate
delay 0.2
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set winPos to position of first window of frontApp
  set winSize to size of first window of frontApp
  return (item 1 of winPos as string) & "," & (item 2 of winPos as string) & "," & (item 1 of winSize as string) & "," & (item 2 of winSize as string)
end tell
`.trim()
  const out = await runAppleScript(script)
  const parts = out.split(",").map((s) => parseInt(s.trim(), 10))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`getWindowBounds parse failed: "${out}"`)
  }
  return { x: parts[0]!, y: parts[1]!, width: parts[2]!, height: parts[3]! }
}

/**
 * 模拟组合键(cliclick 不支持 Cmd 等修饰键 — memory `reference_deskfox_gui_automation.md` §8)。
 * 用 osascript keystroke + using {... down} 桥。
 *
 * @param key       字符或特殊键名
 * @param modifiers 修饰键(空=单键)
 * @param targetProcess 可选 — 把 keystroke 目标定到指定 process(macOS process name,如 "DeskFox"),
 *                     绕过"必须 frontmost 才收 keystroke"问题。**强烈推荐**给 GUI 自动化指定,
 *                     因为 activate 异步可能未真生效就 keystroke,打到 Terminal/IDE 等 frontmost app。
 *
 * @example
 *   keystrokeWithModifiers("k", ["command"], "DeskFox")  // Cmd+K 强制打到 DeskFox process
 *   keystrokeWithModifiers("return", ["command", "shift"])  // 不指定 target,打 frontmost(有风险)
 */
export async function keystrokeWithModifiers(
  key: string,
  modifiers: Modifier[] = [],
  targetProcess?: string,
): Promise<void> {
  const modifiersStr = modifiers.length > 0 ? ` using {${modifiers.map((m) => `${m} down`).join(", ")}}` : ""

  // 特殊键映射(System Events key code 表节选)
  const keyCodeMap: Record<string, number> = {
    return: 36,
    enter: 76,
    tab: 48,
    space: 49,
    escape: 53,
    delete: 51,
    backspace: 51, // alias
    up: 126,
    down: 125,
    left: 123,
    right: 124,
  }

  const lowerKey = key.toLowerCase()
  const code = keyCodeMap[lowerKey]
  const stmt = code !== undefined
    ? `key code ${code}${modifiersStr}`
    : `keystroke ${JSON.stringify(key)}${modifiersStr}`

  const script = targetProcess
    ? `tell application "System Events" to tell process "${targetProcess}" to ${stmt}`
    : `tell application "System Events" to ${stmt}`
  await runAppleScript(script)
}

export type Modifier = "command" | "option" | "control" | "shift"

/**
 * 输入文本(任意 unicode)— 用 System Events keystroke,跟 cliclick.type 互补:
 * - **cliclick.type** ASCII 快(适合长串),非 ASCII 直接拦截
 * - **typeUnicode** 慢但支持中文 / emoji / 任意 unicode
 *
 * @param text         要输入的文本
 * @param targetProcess 可选 — 同 keystrokeWithModifiers,推荐指定避免打错 app
 *
 * 用 keystroke 而非 key code:keystroke 按操作系统 IME / 输入法转换,跟用户真键盘体验对位。
 * 注:macOS IME 可能把中文 unicode 字符当成拼音首字母按键(如"会话"→"AA"),
 * 想精确输入中文要走真 IME 自动化或改 ASCII。
 */
export async function typeUnicode(text: string, targetProcess?: string): Promise<void> {
  const stmt = `keystroke ${JSON.stringify(text)}`
  const script = targetProcess
    ? `tell application "System Events" to tell process "${targetProcess}" to ${stmt}`
    : `tell application "System Events" to ${stmt}`
  await runAppleScript(script)
}

/**
 * 走菜单栏点菜单项(File / Edit / View 等);深度路径用嵌套数组。
 * @example
 *   clickMenuItem("DeskFox Dev", ["File", "Export to Word..."])
 *   clickMenuItem("DeskFox Dev", ["Edit", "Find", "Find..."])  // submenu
 *
 * 比 cliclick 点像素稳 — menu position 跟系统主题 / 屏幕分辨率 / dock 大小都不绑定。
 */
export async function clickMenuItem(appName: string, menuPath: string[]): Promise<void> {
  if (menuPath.length === 0) throw new Error("menuPath empty")
  if (menuPath.length > 3) throw new Error("menuPath 嵌套超过 3 层未实现")

  const [topMenu, ...subs] = menuPath
  let script = `tell application "System Events"\n  tell application process "DeskFox"\n    tell menu bar 1\n      tell menu bar item "${topMenu}"\n`
  if (subs.length === 0) {
    script += `        click\n`
  } else {
    script += `        click\n        delay 0.2\n        tell menu 1\n`
    if (subs.length === 1) {
      script += `          click menu item "${subs[0]}"\n        end tell\n`
    } else {
      // submenu 路径
      script += `          tell menu item "${subs[0]}"\n            click\n            delay 0.2\n            tell menu 1\n              click menu item "${subs[1]}"\n            end tell\n          end tell\n        end tell\n`
    }
  }
  script += `      end tell\n    end tell\n  end tell\nend tell\n`

  await activateApp(appName) // 必须先 active 才能点 menu
  await new Promise((r) => setTimeout(r, 200))
  await runAppleScript(script)
}
