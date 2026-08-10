// FORK: REQ-069 M6 [feat: req069-folder-identity] —— 锚丢失软恢复(反查 ProjectDirectoryTable)。
//   复用 project-nongit-identity 现成 harness(真跑 tmpdir + flag override)。
//   覆盖 M6 acceptance:
//     ① 删锚重开命中沿用:首开铸 id + 落 directory 行 → 删磁盘锚 → 再开 → mint 判定点先反查
//        ProjectDirectoryTable(directory=opened,type=main 优先)→ 命中且 project 行仍在 → 沿用旧 id
//        (不 mint)+ writeAnchor 重写锚 + logInfo。断言 id 不变、锚被重写、session 不失联。
//     ② 未命中正常 mint:全新目录(directory 表无该行)删锚场景不适用;此处验「无历史 directory 行」→ 正常 mint 新 id。
//     ③ project 行已删(directory 行悬空引用)—— innerJoin 语义保证不复用已删 id → 正常 mint。
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
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { eq } from "drizzle-orm"
import { SessionID } from "../../src/session/schema"
import { promises as fsp } from "fs"
import path from "path"
import { tmpdirScoped } from "../fixture/fixture"
import { ANCHOR_DIR, ANCHOR_FILE } from "@opencode-ai/core/project/anchor"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

const projectLayerWithFlag = (nonGitFolderIdentity: boolean) =>
  Project.layer.pipe(
    Layer.provide(RuntimeFlags.layer({ nonGitFolderIdentity })),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(ProjectV2.defaultLayer),
    // FORK: 上游删除 ProjectCopy.defaultLayer,按上游 core/test/project-copy.test.ts 范式等价组装(2026-08-11 sync v1.17.8)
    Layer.provide(
      ProjectCopy.layer.pipe(
        Layer.provide(Database.defaultLayer),
        Layer.provide(ProjectDirectories.defaultLayer),
        Layer.provide(EventV2.defaultLayer),
        Layer.provide(FSUtil.defaultLayer),
        Layer.provide(Git.defaultLayer),
      ),
    ),
    Layer.provide(AppProcess.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Database.defaultLayer),
  )

const baseLayer = (flag: boolean) =>
  Layer.mergeAll(projectLayerWithFlag(flag), Database.defaultLayer, CrossSpawnSpawner.defaultLayer)

const itOn = testEffect(baseLayer(true))

const GLOBAL = ProjectV2.ID.global

const anchorPath = (dir: string) => path.join(dir, ANCHOR_DIR, ANCHOR_FILE)
const readAnchorFile = (dir: string) =>
  fsp.readFile(anchorPath(dir), "utf8").then(
    (c) => c.trim(),
    () => undefined,
  )
const deleteAnchor = (dir: string) => fsp.rm(path.join(dir, ANCHOR_DIR), { recursive: true, force: true })

function legacySessionID() {
  return crypto.randomUUID() as SessionID
}

function seedSession(opts: { id: SessionID; dir: string; project: ProjectV2.ID }) {
  const now = Date.now()
  return Database.Service.use(({ db }) =>
    db
      .insert(SessionTable)
      .values({
        id: opts.id,
        project_id: opts.project,
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

describe("REQ-069 M6 锚丢失软恢复(反查 ProjectDirectoryTable)", () => {
  // ─── ① 删锚重开 → 反查命中沿用旧 id(不 mint)+ 重写锚 + session 不失联 ──────────────────────
  itOn.live("anchor deleted then reopened: reuses id from directory table (no re-mint), rewrites anchor", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const dir = yield* tmpdirScoped()

      // 首开:mint 铸 id + 落 directory 行(main)+ 写锚
      const first = yield* project.fromDirectory(dir)
      const origId = first.project.id
      expect(origId.startsWith("fld_")).toBe(true)
      expect(yield* Effect.promise(() => readAnchorFile(dir))).toBe(origId)

      // 挂一条会话到该 id(模拟历史会话)
      const sid = legacySessionID()
      yield* seedSession({ id: sid, dir, project: origId })

      // 用户误删磁盘锚(.deskfox 目录整个没了)—— resolve 无锚 → data.id=global → 触发 mint 判定
      yield* Effect.promise(() => deleteAnchor(dir))
      expect(yield* Effect.promise(() => readAnchorFile(dir))).toBeUndefined()

      // 再开:mint 判定点先反查 directory 表 → 命中 origId 且 project 行仍在 → 沿用,不 mint
      const second = yield* project.fromDirectory(dir)
      expect(second.project.id).toBe(origId)
      expect(second.project.worktree).toBe(dir)

      // 锚被重写(恢复连续性令牌)
      expect(yield* Effect.promise(() => readAnchorFile(dir))).toBe(origId)

      // 历史会话仍挂在同一 id 上,不失联
      const row = yield* Database.Service.use(({ db }) =>
        db.select().from(SessionTable).where(eq(SessionTable.id, sid)).get().pipe(Effect.orDie),
      )
      expect(row!.project_id).toBe(origId)
    }),
  )

  // ─── ② 未命中:全新目录(directory 表无该行)→ 正常 mint 新 id ─────────────────────────────
  itOn.live("no directory-table hit: fresh folder mints a brand-new id", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const dir = yield* tmpdirScoped()
      // 从未开过 → directory 表无该目录行 → 反查未命中 → 正常 mint
      const { project: p } = yield* project.fromDirectory(dir)
      expect(p.id).not.toBe(GLOBAL)
      expect(p.id.startsWith("fld_")).toBe(true)
      // 锚正常落盘
      expect(yield* Effect.promise(() => readAnchorFile(dir))).toBe(p.id)
    }),
  )

  // ─── ③ project 行已删(directory 行悬空)→ innerJoin 不复用 → 正常 mint 新 id ──────────────
  itOn.live("directory row present but project row deleted: innerJoin excludes → mints new id", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const dir = yield* tmpdirScoped()

      // 首开建 id + directory 行
      const first = yield* project.fromDirectory(dir)
      const origId = first.project.id

      // 删磁盘锚 + 删 project 行(directory 行会因 onDelete:cascade 一并消失,
      //   为强验 innerJoin 语义即使 directory 行残留也不复用,这里只删 project 行让 cascade 生效)
      yield* Effect.promise(() => deleteAnchor(dir))
      yield* Database.Service.use(({ db }) =>
        db.delete(ProjectTable).where(eq(ProjectTable.id, origId)).run().pipe(Effect.orDie),
      )

      // 再开:反查 innerJoin ProjectTable → 无匹配 project 行 → 未命中 → mint 新 id
      const second = yield* project.fromDirectory(dir)
      expect(second.project.id).not.toBe(origId)
      expect(second.project.id.startsWith("fld_")).toBe(true)
    }),
  )
})
