// FORK: REQ-072 follow-up — session.directory 跟随项目身份自愈(共享编排,fork-only)2026-07-05
// [feat: project-continuity-v2026-8-4]
//
// 起源(真机实锤):git 项目彻底改名重开后,身份保持 + scope=project 查询正确返回,但 session 行的
// directory 仍是改名前的死路径 → 前端渲染层按「session.directory === 当前目录」精确匹配过滤 →
// 会话不可见;改回原名才「回来」。REQ-072 修了查询层 directory 过滤,漏了数据本身。
//
// 自愈两级(纯逻辑在 project-rebind.ts):
//  ① 重绑前缀重写(prefixRebindTarget):worktree 旧→新 重绑那一刻,旧树下 directory 映射到新树对应
//     位置(保子目录结构;旧树已被三态判定确切不存在,免查盘)。
//  ② 孤儿清扫:错过重绑的存量死目录(确切 ENOENT;检查出错/离线盘保守不动)扁平到当前 live worktree。
//
// 调用点两处(同一函数,收敛幂等):
//  - Project.fromDirectory(实例 boot,主路径;可携带 oldWorktree 做前缀重写)
//  - Session.list scope=project(兜底:同一进程内实例被缓存、改名往返不再走 fromDirectory 的场景;
//    收敛后成本 ≈ 一次 groupBy,live 树内目录快路径跳过)
import { promises as fsp } from "fs"
import { Effect } from "effect"
import { and, eq } from "drizzle-orm"
import { SessionTable } from "@opencode-ai/core/session/sql"
import type { Database } from "@opencode-ai/core/database/database"
import { isUnderWorktree, prefixRebindTarget } from "./project-rebind"

// FORK: REQ-079 [feat: session-heal-stat-timeout] 2026-08-02 — stat 超时上限(对齐 desktop fs-probe
// 的 3s 竞速模式;包边界隔离只能模式复用不能 import)。离线卷(网络盘/拔掉的 U 盘)上 fs.stat 可能
// 挂几十秒,每次 Session.list 都撞 → 侧栏刷新被死路径拖住。超时 → false(保守不动,与「检查出错」同义)。
export const HEAL_STAT_TIMEOUT_MS = 3000

/**
 * 三态「确切不存在」默认实现(node fs):仅 ENOENT → true;存在/检查出错/超时 → false(保守不动)。
 * [feat: session-heal-stat-timeout] REQ-079 — statFn/timeoutMs 可注入(测试);Promise.race 竞速,
 * 超时后 probe 迟到的结果被丢弃(定时器在 probe settle 时清除,不泄漏)。
 */
export const confirmedMissingByNodeFs = (
  dir: string,
  opts?: { statFn?: (dir: string) => Promise<unknown>; timeoutMs?: number },
): Effect.Effect<boolean> =>
  Effect.promise(() => {
    const stat = opts?.statFn ?? fsp.stat
    const timeoutMs = opts?.timeoutMs ?? HEAL_STAT_TIMEOUT_MS
    const probe = stat(dir).then(
      () => false,
      (err) => (err as NodeJS.ErrnoException)?.code === "ENOENT",
    )
    let handle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<boolean>((resolve) => {
      handle = setTimeout(() => resolve(false), timeoutMs)
    })
    void probe.finally(() => clearTimeout(handle))
    return Promise.race([probe, timeout])
  })

// FORK-BEGIN: REQ-079 [feat: session-heal-stat-timeout] 2026-08-02 — Session.list 调用点进程级闩:
// 每次 list 都全量扫 stat,N 个离线目录 = N×3s 拖住每次侧栏刷新。同 projectID+worktree 只扫一次
// (set-before-run,同 tick 并发第二调用直接跳过 = 防双跑);key 含 worktree → 改名(新 worktree)
// 自动重扫;fromDirectory 主路径不走闩(其 heal 带 oldWorktree 前缀重写语义,须每次跑)。
// 已知边界(spec 记录):离线卷重挂后同进程内不再自动重治,等重启/改名/fromDirectory(TTL 先不加保持简单)。
const healOnceKeys = new Set<string>()

/** 测试用:清空闩(导出仅供测试/诊断) */
export const resetSessionDirHealLatch = (): void => {
  healOnceKeys.clear()
}

/** Session.list 兜底路径专用:同 projectID+worktree 进程生存期内只跑一次 */
export const healStaleSessionDirectoriesOnce = Effect.fn("Project.healStaleSessionDirectoriesOnce")(function* (input: {
  db: Database.Interface["db"]
  projectID: string
  worktree: string
  confirmedMissing?: (dir: string) => Effect.Effect<boolean>
}) {
  const key = `${input.projectID}\0${input.worktree}`
  if (healOnceKeys.has(key)) return
  healOnceKeys.add(key)
  yield* healStaleSessionDirectories(input)
})
// FORK-END

export const healStaleSessionDirectories = Effect.fn("Project.healStaleSessionDirectories")(function* (input: {
  db: Database.Interface["db"]
  projectID: string
  worktree: string
  oldWorktree?: string
  confirmedMissing?: (dir: string) => Effect.Effect<boolean>
}) {
  const confirmedMissing = input.confirmedMissing ?? confirmedMissingByNodeFs
  const sessionDirs = yield* input.db
    .select({ directory: SessionTable.directory })
    .from(SessionTable)
    .where(eq(SessionTable.project_id, input.projectID as any))
    .groupBy(SessionTable.directory)
    .all()
    .pipe(Effect.orDie)
  for (const row of sessionDirs) {
    const dir = row.directory
    if (isUnderWorktree(dir, input.worktree)) continue
    const prefixTarget = input.oldWorktree ? prefixRebindTarget(dir, input.oldWorktree, input.worktree) : undefined
    const target = prefixTarget ?? ((yield* confirmedMissing(dir)) ? input.worktree : undefined)
    if (!target || target === dir) continue
    yield* Effect.logInfo("healing stale session directory", { from: dir, to: target })
    yield* input.db
      .update(SessionTable)
      .set({ directory: target as any })
      .where(and(eq(SessionTable.project_id, input.projectID as any), eq(SessionTable.directory, dir as any)))
      .run()
      .pipe(Effect.orDie)
  }
})
