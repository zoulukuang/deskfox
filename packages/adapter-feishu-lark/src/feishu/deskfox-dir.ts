// [fork-only] `_deskfox/` 项目级约定目录 helper
// [feat: feishu-account-workspace] 2026-06-07
//
// workspace = 账号专用真实项目目录时,飞书收的文件/图片落进 `<ws>/_deskfox/feishu/{files,images}`。
// `_deskfox/` 下划线前缀:可见(不像 `.` 在 mac/linux 被隐藏)、排序靠顶、跟源码目录视觉分开。
// 未来多 IM:`_deskfox/telegram/...` 等,项目根永远只多 `_deskfox/` 一个文件夹。
//
// 首次写入自动往项目 `.gitignore` 追加 `_deskfox/`,不污染用户真实仓库的 git status。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** `_deskfox/` 根目录名(项目级通用约定) */
export const DESKFOX_DIR_NAME = "_deskfox"

/**
 * 规整 account.workspace 字符串:trim 后空 → undefined(=回退默认),非空 → trim 后的值。
 * [fix: feishu-review-followup 2026-06-07] 单一真相源 —— account-store 存盘前 / pipeline 读取时
 * 都走它,避免「判空用 trim 但存/返原值」导致带首尾空格的路径被当目录用(三处逻辑收一处)。
 */
export function normalizeWorkspace(ws: string | undefined | null): string | undefined {
  const t = (ws ?? "").trim()
  return t.length > 0 ? t : undefined
}

/** 飞书收件文件目录:`<workspace>/_deskfox/feishu/files` */
export function deskfoxFeishuFilesDir(workspace: string): string {
  return join(workspace, DESKFOX_DIR_NAME, "feishu", "files")
}

/** 飞书收件图片目录:`<workspace>/_deskfox/feishu/images` */
export function deskfoxFeishuImagesDir(workspace: string): string {
  return join(workspace, DESKFOX_DIR_NAME, "feishu", "images")
}

/**
 * 确保 `<workspace>/_deskfox/` 存在,并幂等往 `<workspace>/.gitignore` 追加 `_deskfox/`。
 *
 * - `.gitignore` 不存在 → 创建,写入 `_deskfox/\n`
 * - 存在但无 `_deskfox/` 行 → 追加(末尾无换行先补换行)
 * - 已含 → 跳过(幂等)
 *
 * best-effort:任何 fs 失败只 warn 不抛(收文件主流程不该被 gitignore 维护阻断)。
 * 可注入 fs/logger 便于单测。
 */
export function ensureDeskfoxDir(
  workspace: string,
  io: {
    existsSync: typeof existsSync
    mkdirSync: typeof mkdirSync
    readFileSync: typeof readFileSync
    writeFileSync: typeof writeFileSync
  } = { existsSync, mkdirSync, readFileSync, writeFileSync },
  logger: { warn: (msg: string) => void } = { warn: (m) => console.warn(m) },
): void {
  const deskfoxRoot = join(workspace, DESKFOX_DIR_NAME)
  try {
    io.mkdirSync(deskfoxRoot, { recursive: true })
  } catch (err) {
    logger.warn(`[deskfox-dir] mkdir ${deskfoxRoot} failed: ${(err as Error).message}`)
  }

  const gitignorePath = join(workspace, ".gitignore")
  const entry = `${DESKFOX_DIR_NAME}/`
  try {
    if (!io.existsSync(gitignorePath)) {
      io.writeFileSync(gitignorePath, `${entry}\n`, "utf-8")
      return
    }
    const raw = io.readFileSync(gitignorePath, "utf-8")
    // 按行精确比对,避免 `_deskfox/` 子串误判(如 `_deskfox/sub`)
    const hasEntry = raw
      .split(/\r?\n/)
      .some((line) => line.trim() === entry || line.trim() === DESKFOX_DIR_NAME)
    if (hasEntry) return
    const prefix = raw.length > 0 && !raw.endsWith("\n") ? "\n" : ""
    io.writeFileSync(gitignorePath, `${raw}${prefix}${entry}\n`, "utf-8")
  } catch (err) {
    logger.warn(`[deskfox-dir] gitignore maintain ${gitignorePath} failed: ${(err as Error).message}`)
  }
}
