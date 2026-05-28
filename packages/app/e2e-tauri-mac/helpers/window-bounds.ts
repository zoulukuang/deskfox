// [fork-only] e2e-tauri-mac/helpers/window-bounds — 窗口位置查询(轻封装)
// [feat: e2e-tauri-phase2-mac] 2026-05-28
//
// 单文件其实是 osascript.getWindowBounds 的 re-export + 衍生 util,提早单独抽出来:
// - 容错(权限拒绝 / app 未启动等)
// - 算锚点(中心 / 左上 / 右下 — cliclick 点击常用)
// - retry 包装(window 在 transition 中查不到位置,等 200ms 再试)

import { getWindowBounds as _getWindowBounds, type WindowBounds } from "./osascript"

export type { WindowBounds }

/**
 * 带 retry 的 window bounds 查询(应付 .app launch 后 window 还在 transition / fade-in)。
 */
export async function getWindowBoundsRetry(
  appName: string,
  maxRetries = 5,
  intervalMs = 300,
): Promise<WindowBounds> {
  let lastErr: unknown
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await _getWindowBounds(appName)
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  }
  throw new Error(`getWindowBoundsRetry(${appName}) 失败 ${maxRetries} 次: ${lastErr}`)
}

/** 窗口中心点(用于触发上下文菜单等"点哪都行"场景)*/
export function centerOf(b: WindowBounds): { x: number; y: number } {
  return { x: b.x + Math.floor(b.width / 2), y: b.y + Math.floor(b.height / 2) }
}

/**
 * 窗口相对锚点(按比例,0-1)。
 * @example
 *   anchorOf(b, 0.5, 0.5)  // 中心
 *   anchorOf(b, 0.2, 0.5)  // 左侧居中(常用于 file tree 区域)
 *   anchorOf(b, 0.8, 0.5)  // 右侧居中(常用于 editor 区域)
 */
export function anchorOf(b: WindowBounds, relX: number, relY: number): { x: number; y: number } {
  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) {
    throw new Error(`anchorOf: relX/relY must be in [0,1], got ${relX}/${relY}`)
  }
  return {
    x: b.x + Math.floor(b.width * relX),
    y: b.y + Math.floor(b.height * relY),
  }
}

/**
 * 窗口标题栏锚点 — cliclick 物理点击此处可强制 .app 拿到 frontmost(避开 osascript activate 异步陷阱)。
 * 选离左侧 200px / 顶部 15px,稳定区域不触发任何 UI(红绿黄按钮 + 标题文字之间空白)。
 */
export function titleBarAnchor(b: WindowBounds): { x: number; y: number } {
  return { x: b.x + 200, y: b.y + 15 }
}
