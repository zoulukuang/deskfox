// [fork-only] voice-acp-bridge — DeskFox「当前打开的项目」跨进程共享 [feat: voice-acp-bridge] 2026-08-24
//
// 1-spec §3.5 要解决的痛点:**网关的工作目录在启动时就钉死了,用户切项目它不跟随。**
// qwen 给桥的 `cwd` 来自 `ACP_WORKSPACE`(同样是启动时的值),所以指望它是没用的。
//
// 桥是 qwen spawn 的独立进程,读不到 Electron 里的任何状态,只能靠一个共享文件。写入侧不需要
// 新增 IPC:renderer 本来就每 5 秒调一次 `voice_status` 并把当前目录传进来(voice-dispatch-button.tsx),
// 主进程顺手记下即可 —— 零新增通道,切项目最多 5 秒后生效。
//
// 读不到 / 内容不合法一律回落到 qwen 给的 cwd,**绝不因为这个文件坏掉就派不出活**。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export interface ActiveProject {
  readonly directory: string
  /** 写入时刻(ms);太旧的记录不信任,见 readActiveProject */
  readonly updatedAt: number
}

/** 与 voice-gateway.log 同一个目录,统一放运行期状态。 */
export function activeProjectPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const stateHome = env.XDG_STATE_HOME || join(home, ".local", "state")
  return join(stateHome, "deskfox", "voice-active-project.json")
}

/** 记录当前项目。写失败静默 —— 这是"锦上添花"的跟随能力,不该反过来搞垮语音。 */
export function writeActiveProject(
  directory: string,
  file: string = activeProjectPath(),
  now: number = Date.now(),
  write: (p: string, c: string) => void = (p, c) => {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, c)
  },
): boolean {
  const dir = String(directory ?? "").trim()
  if (!dir) return false
  try {
    write(file, JSON.stringify({ directory: dir, updatedAt: now } satisfies ActiveProject))
    return true
  } catch {
    return false
  }
}

/**
 * 读当前项目。任何一处不对就返回空串,由调用方回落。
 *
 * `maxAgeMs` 默认 24 小时:文件是上次开语音时留下的、而 DeskFox 早就关了的话,
 * 拿它去建 session 会落到一个用户此刻根本没在看的项目里 —— 那比不跟随更糟。
 */
export function readActiveProject(
  file: string = activeProjectPath(),
  now: number = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1000,
  read: (p: string) => string | null = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  exists: (p: string) => boolean = existsSync,
): string {
  try {
    const raw = read(file)
    if (!raw) return ""
    const parsed = JSON.parse(raw) as Partial<ActiveProject>
    const dir = String(parsed?.directory ?? "").trim()
    if (!dir || !exists(dir)) return ""
    const at = Number(parsed?.updatedAt ?? 0)
    if (!Number.isFinite(at) || now - at > maxAgeMs) return ""
    return dir
  } catch {
    return ""
  }
}
