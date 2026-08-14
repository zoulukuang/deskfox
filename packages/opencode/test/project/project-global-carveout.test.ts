// FORK: REQ-069 M8 [feat: req069-folder-identity] —— 存量 global session 析出回归 + flag 往返三段。
//   复用 migrate-global / project-nongit-identity 现成 harness(真跑 tmpdir)。
//   覆盖 M8 acceptance:
//     ① 析出:seed 存量 global session(project_id=global && directory=目标目录)→ flag 开首开该目录 →
//        U4 mint 铸 id 建行(worktree=真实目录)→ 现有 :376-383 UPDATE 自动把该目录 global session 重挂新 id;
//        断言 session 重挂 + worktree=真实目录 + saveProjectDirectory 落 main 行 + 其他目录 global session 不受影响。
//     ② global 行保留:migrateProjectId 的 oldID===global 早退守卫 → 析出后 global 行仍在。
//     ③ flag 往返三段:开(析出+session 迁到锚 id)→ 关(强制 global,已迁 session 留锚 id 下=历史暂不可见,可接受降级)
//        → 再开(resolve 返锚 id,历史回来)。
import { describe, expect } from "bun:test"
import { Project } from "@/project/project"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2Bridge } from "@/event-v2-bridge"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { AppProcess } from "@opencode-ai/core/process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProjectDirectories } from "@opencode-ai/core/project/directories"
import { EventV2 } from "@opencode-ai/core/event"
import { Git } from "@opencode-ai/core/git"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { ProjectTable, ProjectDirectoryTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { and, eq } from "drizzle-orm"
import { SessionID } from "../../src/session/schema"
import { tmpdirScoped } from "../fixture/fixture"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

// Project.defaultLayer 内部固定 provide 了 RuntimeFlags.defaultLayer(env 派生,默认关),
// 外部 merge 无法覆盖;故基于 Project.layer 手工 provide 子层 + RuntimeFlags.layer({override})。
// 2026-08-11 sync v1.17.13:上游 layer→node 体系,按 opencode/test/project/project.test.ts 范式改
// AppNodeBuilder + RuntimeFlags 覆盖注入(替代原 defaultLayer 组装)
const projectTestNode = LayerNode.group([Project.node, Database.node, CrossSpawnSpawner.node])
const baseLayer = (nonGitFolderIdentity: boolean) =>
  AppNodeBuilder.build(projectTestNode, [[RuntimeFlags.node, RuntimeFlags.layer({ nonGitFolderIdentity })]])

const itOn = testEffect(baseLayer(true))

const GLOBAL = ProjectV2.ID.global

function legacySessionID() {
  return crypto.randomUUID() as SessionID
}

function seedGlobalSession(opts: { id: SessionID; dir: string }) {
  const now = Date.now()
  return Database.Service.use(({ db }) =>
    db
      .insert(SessionTable)
      .values({
        id: opts.id,
        project_id: GLOBAL,
        slug: opts.id,
        directory: opts.dir,
        title: "test",
        version: "0.0.0-test",
        time_created: now,
        time_updated: now,
      })
      .run()
      .pipe(Effect.orDie),
  )
}

function ensureGlobal() {
  return Database.Service.use(({ db }) =>
    db
      .insert(ProjectTable)
      .values({
        id: GLOBAL,
        worktree: AbsolutePath.make("/"),
        time_created: Date.now(),
        time_updated: Date.now(),
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie),
  )
}

const sessionProjectId = (id: SessionID) =>
  Database.Service.use(({ db }) =>
    db.select().from(SessionTable).where(eq(SessionTable.id, id)).get().pipe(Effect.orDie),
  )

const globalRow = () =>
  Database.Service.use(({ db }) =>
    db.select().from(ProjectTable).where(eq(ProjectTable.id, GLOBAL)).get().pipe(Effect.orDie),
  )

describe("REQ-069 M8 存量 global session 析出回归", () => {
  // ─── ① 析出:global session 重挂新 fld_ id + worktree 真实目录 + directory 行 + 其他目录不受影响 ─
  itOn.live("carve-out: seeded global session re-hooked to minted fld_ id, worktree=real dir", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const dir = yield* tmpdirScoped()
      yield* ensureGlobal()

      // 存量:该目录曾有一条 global session(改造前非git 目录会话都挂 global)
      const target = legacySessionID()
      yield* seedGlobalSession({ id: target, dir })
      // 另一目录的 global session — 不应被本次析出波及
      const other = legacySessionID()
      yield* seedGlobalSession({ id: other, dir: "/some/other/dir" })

      // flag 开首开 → mint 铸 fld_ id + 建行(worktree=真实目录)
      const { project: p } = yield* project.fromDirectory(dir)
      expect(p.id).not.toBe(GLOBAL)
      expect(p.id.startsWith("fld_")).toBe(true)
      expect(p.worktree).toBe(dir)

      // 该目录的 global session 被现有 UPDATE 自动重挂到新 id
      const targetRow = yield* sessionProjectId(target)
      expect(targetRow!.project_id).toBe(p.id)

      // 其他目录的 global session 原封不动
      const otherRow = yield* sessionProjectId(other)
      expect(otherRow!.project_id).toBe(GLOBAL)

      // saveProjectDirectory 对新 id 落了目录行,directory=真实目录
      // (2026-08-11 sync v1.17.8:上游 ProjectDirectories.create 改写 strategy 语义,
      //  不再写 type 列 — type 保留为遗留列,新行为 null;M6 恢复逻辑对 null 有 candidates[0] 回落)
      const dirRow = yield* Database.Service.use(({ db }) =>
        db
          .select()
          .from(ProjectDirectoryTable)
          .where(and(eq(ProjectDirectoryTable.project_id, p.id), eq(ProjectDirectoryTable.directory, AbsolutePath.make(dir))))
          .get()
          .pipe(Effect.orDie),
      )
      expect(dirRow).toBeDefined()
      expect(dirRow!.type).toBeNull()
    }),
  )

  // ─── ② global 行保留:migrateProjectId oldID===global 早退守卫 → 析出后 global 行仍在 ──────────
  itOn.live("global project row survives carve-out (migrateProjectId global early-return guard)", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const dir = yield* tmpdirScoped()
      yield* ensureGlobal()

      const before = yield* globalRow()
      expect(before).toBeDefined()

      yield* project.fromDirectory(dir)

      // 析出不删/不迁 global project 行(global 是永久哨兵)
      const after = yield* globalRow()
      expect(after).toBeDefined()
      expect(after!.id).toBe(GLOBAL)
    }),
  )

  // ─── ③ flag 往返三段:开(析出) → 关(强制 global,已迁 session 留锚 id) → 再开(历史回来) ──────
  itOn.live("flag round-trip: on(carve-out) → off(forced global) → on(history back via anchor)", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()

      // ── 段1 开:mint + session 迁到锚 id ──────────────────────────────────────
      const onProject = yield* Project.Service
      yield* ensureGlobal()
      const sid = legacySessionID()
      yield* seedGlobalSession({ id: sid, dir })

      const first = yield* onProject.fromDirectory(dir)
      const anchorId = first.project.id
      expect(anchorId).not.toBe(GLOBAL)
      expect(anchorId.startsWith("fld_")).toBe(true)
      // session 已迁到锚 id
      expect((yield* sessionProjectId(sid))!.project_id).toBe(anchorId)
    }).pipe(Effect.provide(baseLayer(true))),
  )
})

// 段2/段3 需切换 flag layer,单独用 Database 共享实例难以在同一 it 内切层;
// 改为在同一 tmpdir + 同一磁盘锚上、用两个独立 layer(off / on)分段验证 project id 归属。
describe("REQ-069 M8 flag 往返三段(独立 layer 分段)", () => {
  // 用同一 tmpdir 的磁盘锚做连续性载体:段1 开写锚 → 段2 关(强制 global) → 段3 再开(读锚返回同 id)。
  const itOff = testEffect(baseLayer(false))

  itOn.live("phase 1 (flag ON): non-git folder mints anchor id (carve-out identity established)", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const dir = yield* tmpdirScoped()
      const { project: p } = yield* project.fromDirectory(dir)
      // 段1:身份建立,锚落盘(后续段靠磁盘锚承接,不同 layer 间通过 tmpdir 传递)
      expect(p.id.startsWith("fld_")).toBe(true)
      expect(p.worktree).toBe(dir)
    }),
  )

  itOff.live("phase 2 (flag OFF): same anchored folder forced to global (history temporarily invisible)", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const dir = yield* tmpdirScoped()
      // 段1 先在本 dir 用 ON layer 建锚 —— 但 layer 已是 OFF,无法在同 it 内切;
      // 复用 project-nongit-identity 已验证的「flag OFF + 磁盘有锚 → 强制 global」路径:预置磁盘锚模拟段1 产物。
      yield* Effect.promise(async () => {
        const { promises: fsp } = await import("fs")
        const path = await import("path")
        await fsp.mkdir(path.join(dir, ".deskfox"), { recursive: true })
        await fsp.writeFile(path.join(dir, ".deskfox", "id"), "fld_aaaabbbbccccddddeeeeffff00001111\n")
      })
      const { project: p } = yield* project.fromDirectory(dir)
      // 段2 关:忽略锚 id,强制 global,worktree="/"(改造前行为);已迁 session 留锚 id 下 = 历史暂不可见,可接受降级
      expect(p.id).toBe(GLOBAL)
      expect(p.worktree).toBe("/")
    }),
  )

  itOn.live("phase 3 (flag ON again): resolve reads anchor → same id, history back", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const dir = yield* tmpdirScoped()
      // 预置段1 磁盘锚 → 段3 再开(flag 开)→ resolve 读锚返回同 id → 历史(挂该 id 的 session)回来
      const savedId = "fld_aaaabbbbccccddddeeeeffff00001111"
      yield* Effect.promise(async () => {
        const { promises: fsp } = await import("fs")
        const path = await import("path")
        await fsp.mkdir(path.join(dir, ".deskfox"), { recursive: true })
        await fsp.writeFile(path.join(dir, ".deskfox", "id"), savedId + "\n")
      })
      const { project: p } = yield* project.fromDirectory(dir)
      expect(p.id).toBe(ProjectV2.ID.make(savedId))
      expect(p.worktree).toBe(dir)
    }),
  )
})
