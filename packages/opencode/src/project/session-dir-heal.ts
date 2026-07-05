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

/** 三态「确切不存在」默认实现(node fs):仅 ENOENT → true;存在/检查出错 → false(保守不动) */
export const confirmedMissingByNodeFs = (dir: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    fsp.stat(dir).then(
      () => false,
      (err: NodeJS.ErrnoException) => err?.code === "ENOENT",
    ),
  )

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
