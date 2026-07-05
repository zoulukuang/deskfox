// FORK: REQ-061 M5 三态 — worktree 重绑的「确切不存在」判定(可单测)。2026-06-25 [feat: stale-path-hardening]
import { Effect } from "effect"

/**
 * 判断 worktree 是否「确切不存在」,从而需要按实际打开路径重绑(REQ-061)。
 *
 * 三态(对应 effect 平台 fs.exists 语义:ENOENT→succeed(false),其它 PlatformError→fail):
 *  - exists 成功返回 false(ENOENT)        → 确切不存在 → true(应重绑)
 *  - exists 成功返回 true                   → 仍在      → false(不重绑)
 *  - exists 失败(EACCES/网络盘离线/U盘暂拔/超时,检查出错) → 保守当作仍在 → false(不重绑)
 *
 * 关键:绝不能把「检查出错」当成「不存在」——否则会把仍有效、只是暂不可达的 worktree 误改掉
 * (网络盘 Z: 离线、U 盘暂拔时重开项目即中招)。
 */
export const isWorktreeConfirmedMissing = <E, R>(
  exists: Effect.Effect<boolean, E, R>,
): Effect.Effect<boolean, never, R> =>
  exists.pipe(
    Effect.map((present) => !present),
    Effect.orElseSucceed(() => false),
  )

/**
 * 沙箱目录保留判定(REQ-064 加固,与上面三态哲学一致):只在「确切探到不存在」时剔除沙箱;
 * exists 检查出错(离线盘/U盘暂拔/超时)保守保留,绝不 die→整个 update 500、也不误删有效沙箱。
 *
 * 三态(对应 effect 平台 fs.exists 语义:ENOENT→succeed(false),其它 PlatformError→fail):
 *  - exists succeed(true)  → 保留 sandbox
 *  - exists succeed(false) → 剔除(undefined)
 *  - exists fail(检查出错) → 保守保留 sandbox(不 die)
 *
 * 起源:原沙箱循环用 `fs.exists(s).pipe(Effect.orDie, …)`,离线盘 exists 出错会 die 成 defect →
 * fromDirectory 崩 → /project update(改名/移动后自愈重试)整请求 500,而非优雅降级。
 */
export const keepSandboxUnlessConfirmedGone = <E, R>(
  sandbox: string,
  exists: Effect.Effect<boolean, E, R>,
): Effect.Effect<string | undefined, never, R> =>
  exists.pipe(
    Effect.map((present) => (present ? sandbox : undefined)),
    Effect.orElseSucceed(() => sandbox),
  )

// FORK-BEGIN: REQ-072 follow-up — session.directory 跟随项目身份自愈(纯函数,Logic 清单)2026-07-05
// 起源(真机实锤):git 项目彻底改名重开后,后端身份保持 + scope=project 查询正确返回,但 session 行的
// directory 仍是改名前的死路径 → 前端渲染层 isRootVisibleSession 按「session.directory === 当前目录」
// 精确匹配过滤 → 会话不可见;改回原名才「回来」。REQ-072 只修了查询层的 directory 过滤,漏了数据本身。
// 修法 = 数据自愈(单点,所有消费点一次根治),两级:
//  ① 重绑前缀重写(prefixRebindTarget):worktree 旧→新 重绑那一刻,旧树下的 directory 映射到新树对应
//     位置(保子目录结构;旧 worktree 已被三态判定确切不存在,无需再查盘)。
//  ② 孤儿清扫(orchestrated in project.ts):错过重绑的存量死目录(本 bug 的既有受害行)按三态存在性
//     判定(isWorktreeConfirmedMissing,检查出错/离线盘保守不动)扁平到当前 live worktree。

/** 目录是否属于 worktree 树内(live 快路径,免查盘、不触碰上游子目录语义) */
export function isUnderWorktree(dir: string, worktree: string): boolean {
  return dir === worktree || dir.startsWith(worktree + "/") || dir.startsWith(worktree + "\\")
}

/** 重绑前缀重写:dir 在旧 worktree 树下 → 新 worktree 对应位置;否则 undefined(不归它管) */
export function prefixRebindTarget(dir: string, oldWorktree: string, worktree: string): string | undefined {
  if (dir === oldWorktree) return worktree
  if (dir.startsWith(oldWorktree + "/") || dir.startsWith(oldWorktree + "\\")) {
    return worktree + dir.slice(oldWorktree.length)
  }
  return undefined
}
// FORK-END
