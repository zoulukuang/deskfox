// FORK: REQ-072 复制项目独立展示 [feat: project-continuity-v2026-8-4] —— 副本根目录不是 sandbox。
//   真机实锤:目录 A 复制为 B 后在 DeskFox 打开 B,会整体跳回 A。根因:fromDirectory 把 B(effectiveDir
//   ≠ 行 worktree)按上游逻辑登记进 project.sandboxes → 前端 reconciler 按 sandbox→root 折叠掉 B 条目。
//   修法:B 自身就是身份根(git 独立 .git 目录 / 非 git 锚在目录内)→ 不登记 + 清历史污染;
//   链接 git worktree(.git 是文件)保持上游 sandbox 折叠不回归。
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
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { eq } from "drizzle-orm"
import { $ } from "bun"
import path from "path"
import { tmpdirScoped } from "../fixture/fixture"
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

async function gitRepoWithCommit(dir: string) {
  await $`mkdir -p ${dir}`.quiet()
  await $`git init`.cwd(dir).quiet()
  await $`git -c user.email=t@example.com -c user.name=test commit --allow-empty -m init`.cwd(dir).quiet()
}

const rowSandboxes = (id: string) =>
  Database.Service.use(({ db }) =>
    db
      .select()
      .from(ProjectTable)
      .where(eq(ProjectTable.id, ProjectV2.ID.make(id)))
      .get()
      .pipe(
        Effect.orDie,
        Effect.map((row) => row?.sandboxes ?? []),
      ),
  )

describe("Project.fromDirectory copy standalone (REQ-072 复制项目独立展示)", () => {
  itOn.live("git 副本:同身份但不登记 sandbox,instance worktree = 副本自身", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const a = path.join(root, "proj-A")
      const b = path.join(root, "proj-B-copy")

      yield* Effect.promise(() => gitRepoWithCommit(a))
      const first = yield* project.fromDirectory(a)
      const id = first.project.id

      yield* Effect.promise(() => $`cp -R ${a} ${b}`.quiet())
      const second = yield* project.fromDirectory(b)

      expect(second.project.id).toBe(id) // 同身份(session 共享的来源)
      expect(second.project.worktree).toBe(a) // 原项目主位置不被副本抢走
      expect(second.sandbox).toBe(b) // 实例锚在副本自身
      expect(yield* rowSandboxes(id)).not.toContain(AbsolutePath.make(b)) // 不登记 sandbox → 前端不折叠
    }),
  )

  itOn.live("历史污染自愈:旧版已把副本登记进 sandboxes,重开副本即清除", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const a = path.join(root, "heal-A")
      const b = path.join(root, "heal-B-copy")

      yield* Effect.promise(() => gitRepoWithCommit(a))
      const first = yield* project.fromDirectory(a)
      const id = first.project.id
      yield* Effect.promise(() => $`cp -R ${a} ${b}`.quiet())

      // 模拟旧版行为:手工把 B 塞进 sandboxes
      yield* Database.Service.use(({ db }) =>
        db
          .update(ProjectTable)
          .set({ sandboxes: [AbsolutePath.make(b)] })
          .where(eq(ProjectTable.id, ProjectV2.ID.make(id)))
          .run()
          .pipe(Effect.orDie),
      )
      expect(yield* rowSandboxes(id)).toContain(AbsolutePath.make(b))

      yield* project.fromDirectory(b)
      expect(yield* rowSandboxes(id)).not.toContain(AbsolutePath.make(b)) // 打开即自愈
    }),
  )

  itOn.live("非 git 锚副本:同 id 不登记 sandbox", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const a = path.join(root, "plain-A")
      const b = path.join(root, "plain-B-copy")

      yield* Effect.promise(() => $`mkdir -p ${a}`.quiet())
      const first = yield* project.fromDirectory(a) // flag 开 → mint + 写锚
      const id = first.project.id
      expect(id).not.toBe(ProjectV2.ID.global)

      yield* Effect.promise(() => $`cp -R ${a} ${b}`.quiet()) // 锚随副本走
      const second = yield* project.fromDirectory(b)

      expect(second.project.id).toBe(id)
      expect(second.project.worktree).toBe(a)
      expect(second.sandbox).toBe(b)
      expect(yield* rowSandboxes(id)).not.toContain(AbsolutePath.make(b))
    }),
  )

  itOn.live("链接 git worktree(.git 是文件)仍登记 sandbox —— 上游折叠行为不回归", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const a = path.join(root, "wt-A")
      const w = path.join(root, "wt-linked")

      yield* Effect.promise(() => gitRepoWithCommit(a))
      const first = yield* project.fromDirectory(a)
      const id = first.project.id

      yield* Effect.promise(() => $`git worktree add ${w}`.cwd(a).quiet())
      const second = yield* project.fromDirectory(w)

      expect(second.project.id).toBe(id)
      expect(yield* rowSandboxes(id)).toContain(AbsolutePath.make(w)) // 链接工作树照旧是 sandbox
    }),
  )
})
