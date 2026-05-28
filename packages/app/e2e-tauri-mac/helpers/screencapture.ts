// [fork-only] e2e-tauri-mac/helpers/screencapture — screencapture + sips 裁图封装
// [feat: e2e-tauri-phase2-mac] 2026-05-28
//
// screencapture 是 macOS 内置截屏工具,sips 是图片处理(裁剪 / 缩放)— 都自带不用装。
// 用法套路 memory `reference_deskfox_gui_automation.md` §视觉断言。
//
// 适用场景:
// - smoke spec 验 .app 启动后窗口有内容(非全黑屏)— takeFullScreen + 文件大小阈值
// - 故障诊断 — 测试 fail 时截屏存档,后续 user / agent 看
// - 视觉 diff(本 feat 不做,留 backlog)

import { exec } from "node:child_process"
import { promisify } from "node:util"
import { statSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import { mkdirSync } from "node:fs"

const execP = promisify(exec)

/**
 * 全屏截图到 savePath(.png)。
 * -x 静默无快门声;-T 0 立即截不延迟。
 * timeout 默认 5s。
 */
export async function takeFullScreen(savePath: string): Promise<void> {
  // 自动创目录
  const dir = dirname(savePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  await execP(`screencapture -x -T 0 ${JSON.stringify(savePath)}`, { timeout: 5_000 })
  if (!existsSync(savePath)) throw new Error(`screencapture didn't create ${savePath}`)
}

/**
 * 裁图(用 sips,macOS 自带)。
 *
 * srcPath → dstPath(都 .png),按 (x, y, width, height) 裁出子区域。
 * sips 的 --cropToHeightWidth + --cropOffset 参数顺序敏感,封装稳。
 */
export async function cropImage(
  srcPath: string,
  dstPath: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  const dir = dirname(dstPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  // sips 不支持原地修改,先 cp 再 crop
  await execP(`cp ${JSON.stringify(srcPath)} ${JSON.stringify(dstPath)}`)
  await execP(
    `sips -c ${height} ${width} --cropOffset ${y} ${x} ${JSON.stringify(dstPath)} --out ${JSON.stringify(dstPath)}`,
    { timeout: 5_000 },
  )
}

/**
 * 取文件大小(bytes)— 用于"截屏非空白"等阈值断言。
 * 标准 .png 50KB+ 才有内容,1KB 多半是全黑 / 全白。
 */
export function getFileSize(path: string): number {
  return statSync(path).size
}

/**
 * 联动:截全屏 → 裁出窗口区域。
 * 需要先 getWindowBounds()(osascript.ts)拿绝对坐标。
 *
 * @param savePath  最终窗口区域 .png 落盘路径
 * @param bounds    osascript getWindowBounds() 结果
 */
export async function captureWindowArea(
  savePath: string,
  bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
  // 中间产物
  const tmpFull = `/tmp/deskfox-e2e/_fullscreen-${Date.now()}.png`
  await takeFullScreen(tmpFull)
  await cropImage(tmpFull, savePath, bounds.x, bounds.y, bounds.width, bounds.height)
  // 中间产物保留(故障诊断用,/tmp 系统自动清)
}
