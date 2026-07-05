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
 * 写失败(只读卷/权限/受控目录)降级为 Effect.ignore,不抛错。
 * macOS 走通;平台薄层留 Windows 接口(阶段二实现)。
 */
export const writeAnchor = (dir: string, id: ID): Effect.Effect<void, never, FSUtil.Service> =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const anchorPath = path.join(dir, ANCHOR_DIR, ANCHOR_FILE)
    yield* fs.writeWithDirs(anchorPath, id + "\n").pipe(Effect.ignore)
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

/**
 * 隐藏锚目录(平台薄层接口占位)。
 * macOS: 点文件(.deskfox)Finder 天然隐藏,空实现即可。
 * Windows 阶段二补 attrib +h / SetFileAttributes 实现。
 * 签名平台无关,调用方无需区分平台。
 */
export const hideAnchorDir = (_dir: string): Effect.Effect<void, never, never> => Effect.void
