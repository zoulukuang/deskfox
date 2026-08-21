// [fork-only] REQ-102 语音派活 — 路径解析(仓根 / wrapper) [feat: voice-dispatch-minimal] 2026-08-21
//
// D-G 的代价在这儿兑现:本批(自用)的 ACP 宿主是**本机源码树**,所以主进程必须知道 fork 仓根。
// 三级解析,越靠前越显式:
//   ① env `DESKFOX_VOICE_REPO_ROOT`(power user / 换盘符时的逃生阀)
//   ② 开发态:从 main 的编译产物位置上溯(`out/main` → 仓根)
//   ③ 打包态:没有源码树 —— 返回空,语音入口据此禁用并给出原因(R5)
//
// 产品化路径(编译 1.x CLI 二进制随包带)落地后,本文件的 ②③ 会被那条替换。
//
// ⚠️ 本模块**刻意不 import electron**:测试装置(scripts/local-test/voice/)要 import 这些解析
// 函数,而在 Electron 之外一 import electron 就炸(data-namespace.ts 那个坑同源)。
// `app.isPackaged` 由调用方(ipc.ts,它本来就在主进程里)传进来。

import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { ACP_ENTRY_RELATIVE } from "./launch-env"

const MAIN_DIR = dirname(fileURLToPath(import.meta.url))

/** 判定一个目录像不像 fork 仓根(有 1.x ACP 入口才算)。 */
export function looksLikeForkRepo(dir: string, exists: (p: string) => boolean = existsSync): boolean {
  if (!dir) return false
  return exists(join(dir, ACP_ENTRY_RELATIVE))
}

export function resolveVoiceRepoRoot(input: {
  readonly env?: NodeJS.ProcessEnv
  readonly packaged: boolean
  readonly mainDir?: string
  readonly exists?: (p: string) => boolean
}): string {
  const env = input.env ?? process.env
  const exists = input.exists ?? existsSync
  const fromEnv = String(env.DESKFOX_VOICE_REPO_ROOT ?? "").trim()
  if (fromEnv && looksLikeForkRepo(fromEnv, exists)) return fromEnv
  if (input.packaged) return "" // 打包态没有源码树,老实返回空(语音入口会禁用并说明)
  // out/main → packages/desktop/out/main;上溯 4 级到仓根
  const guess = resolve(input.mainDir ?? MAIN_DIR, "..", "..", "..", "..")
  return looksLikeForkRepo(guess, exists) ? guess : ""
}

export function voiceRepoRoot(packaged: boolean): string {
  return resolveVoiceRepoRoot({ packaged })
}

/** wrapper 脚本路径 —— 与仓根同源(它就住在仓里)。 */
export function resolveWrapperPath(repoRoot: string): string {
  return repoRoot ? join(repoRoot, "packages", "desktop", "scripts", "deskfox-acp-wrap.mjs") : ""
}

export function voiceWrapperPath(packaged: boolean): string {
  return resolveWrapperPath(voiceRepoRoot(packaged))
}
