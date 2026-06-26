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
