// FORK-ONLY: REQ-069 锚契约核心 2026-07-04
//
// 非 git 文件夹稳定身份 — 锚模块(核心读侧 + 平台薄层接口)。
// 锚全路径: <dir>/.deskfox/id
//
// ⚠️  .deskfox 目录勿加入 .gitignore / 清理规则。
//    锚丢失 = 旧会话失联(M6 软恢复可补救,但恢复成本高)。
//    git 防污染由 writeAnchor 调用方追加 .deskfox/ 到 .git/info/exclude 实现(U2)。
//
// 本模块含 FSUtil Effect 依赖的 IO 函数(非纯函数集)。
// U2 在本文件扩写侧(writeAnchor / appendToInfoExclude)。
// 详见 docs/features/req069-folder-identity/

import path from "path"
import { Effect } from "effect"
import { randomBytes } from "crypto"
import { execFile } from "child_process"
import { FSUtil } from "../fs-util"
import { ID } from "../project"

// ─── 磁盘契约常量(单点收口,发布后不可改名) ───────────────────────────────────

/**
 * 锚目录名。锚全路径: <dir>/.deskfox/id
 * R3 磁盘契约收口 — 任何代码不得散写此字符串。
 */
export const ANCHOR_DIR = ".deskfox"

/**
 * 锚文件名。锚全路径: <dir>/.deskfox/id
 * R3 磁盘契约收口 — 任何代码不得散写此字符串。
 */
export const ANCHOR_FILE = "id"

// ─── 纯函数 ─────────────────────────────────────────────────────────────────

/**
 * 铸造稳定项目 id。
 * 纯函数,不写盘。格式: "fld_" + 16 字节随机 hex(与现有 ID 生成惯例对齐)。
 */
export function mintId(): ID {
  return ID.make("fld_" + randomBytes(16).toString("hex"))
}

// ─── IO 函数(Effect) ────────────────────────────────────────────────────────

/**
 * 读锚:返回锚文件内容(作为项目 ID)。
 * 四态处理:
 *   - 文件不存在 → undefined
 *   - 读失败(权限/离线卷等) → undefined
 *   - 内容为空/空白 → undefined
 *   - 正常读取 → ID
 * 绝不抛错、绝不写盘。
 */
export const readAnchor = (dir: string): Effect.Effect<ID | undefined, never, FSUtil.Service> =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const anchorPath = path.join(dir, ANCHOR_DIR, ANCHOR_FILE)
    // catch 所有错误(NotFound/PermissionDenied/离线卷等),统一降级为 undefined
    const content = yield* fs.readFileString(anchorPath).pipe(Effect.catch(() => Effect.succeed(undefined as string | undefined)))
    if (content === undefined) return undefined
    const trimmed = content.trim()
    if (!trimmed) return undefined
    return ID.make(trimmed)
  })

// ─── 写侧 IO 函数(U2) ────────────────────────────────────────────────────────

/**
 * 写锚文件。将 id 写入 <dir>/.deskfox/id。
 * 写失败(只读卷/权限/受控目录)降级不抛错。
 * 写成功后隐藏锚目录(Windows attrib +h;macOS 点目录天然隐藏 no-op)。
 * FORK: win-anchor-hide-case-fold — 写成功才隐藏(写失败无锚可隐藏),hide 可注入便于单测。2026-07-07
 * hide 参数默认真实 hideAnchorDir,测试可注入 spy 验证「写成功→隐藏」链路。
 */
export const writeAnchor = (
  dir: string,
  id: ID,
  hide: (dir: string) => Effect.Effect<void, never, never> = hideAnchorDir,
): Effect.Effect<void, never, FSUtil.Service> =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const anchorPath = path.join(dir, ANCHOR_DIR, ANCHOR_FILE)
    // 写成功 → true;写失败(只读卷/权限)→ false,降级不抛
    const wrote = yield* fs
      .writeWithDirs(anchorPath, id + "\n")
      .pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
    // 只在确实写出锚后隐藏(写失败时无锚目录可隐藏)
    if (wrote) yield* hide(dir)
  })

/**
 * 追加条目到 .git/info/exclude,防止锚目录污染 git status。
 * 参数:
 *   gitStore — 调用方传入已解析的 repo.store(.git 目录路径,由 fromDirectory 从 data.vcs.store 取)
 *   entry    — 要追加的行(如 ".deskfox/")
 * 行为:
 *   - 幂等去重:已含 entry 不重复追加
 *   - exclude 文件不存在时创建(含父目录)
 *   - 失败降级不抛错
 * 不自行 rev-parse(worktree/gitdir 分离场景由调用方传正确 store)。
 */
export const appendToInfoExclude = (gitStore: string, entry: string): Effect.Effect<void, never, FSUtil.Service> =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const excludePath = path.join(gitStore, "info", "exclude")
    // 读已有内容;文件不存在则视为空
    const existing = yield* fs.readFileString(excludePath).pipe(Effect.catch(() => Effect.succeed("")))
    // 幂等去重:按行检查,避免误匹配(如 ".deskfox" 也匹配 ".deskfox/")
    const lines = existing.split("\n")
    const alreadyPresent = lines.some((l) => l.trim() === entry.trim())
    if (alreadyPresent) return
    // 确保文件结尾有换行后追加
    const newContent = (existing.endsWith("\n") || existing === "" ? existing : existing + "\n") + entry + "\n"
    yield* fs.writeWithDirs(excludePath, newContent).pipe(Effect.ignore)
  })

// ─── 平台薄层接口 ────────────────────────────────────────────────────────────

/** 隐藏属性执行器注入点(便于单测,默认真实 `attrib +h`)。 */
export type SetHiddenFn = (target: string) => Promise<void>

/**
 * 默认隐藏执行器:Windows 上跑 `attrib +h <target>` 给目录打隐藏属性。
 * 无论 attrib 成功/失败/不存在都 resolve —— 隐藏是「锦上添花」,失败绝不阻塞写锚。
 */
const defaultSetHidden: SetHiddenFn = (target) =>
  new Promise<void>((resolve) => {
    execFile("attrib", ["+h", target], () => resolve())
  })

/**
 * 隐藏锚目录(平台薄层)。
 * FORK: win-anchor-hide-case-fold — 兑现 REQ-069 阶段二 Windows 隐藏属性。2026-07-07
 *  - Windows: 对 <dir>/.deskfox 目录设隐藏属性(attrib +h),否则资源管理器里每个项目文件夹
 *    都可见一个 .deskfox 目录,用户困惑/误删(锚丢失=旧会话失联)。
 *  - macOS/Linux: 点开头目录 Finder 天然隐藏,no-op。
 * 平台判定与执行器均可注入,便于跨平台单测(生产默认 process.platform + 真实 attrib)。
 * 降级哲学:任何失败(attrib 不存在/权限/受控目录)都静默,绝不抛错、不影响写锚成功。
 */
export const hideAnchorDir = (
  dir: string,
  opts?: { platform?: NodeJS.Platform; setHidden?: SetHiddenFn },
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    const platform = opts?.platform ?? process.platform
    if (platform !== "win32") return
    const setHidden = opts?.setHidden ?? defaultSetHidden
    const target = path.join(dir, ANCHOR_DIR)
    yield* Effect.promise(() => setHidden(target).catch(() => {})).pipe(Effect.ignore)
  })
