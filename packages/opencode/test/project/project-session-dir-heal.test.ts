// FORK: REQ-072 follow-up [feat: project-continuity-v2026-8-4] —— session.directory 跟随项目身份自愈集成测。
//   真机实锤 bug:git 项目彻底改名重开后,身份保持 + scope=project 查询正确,但 session.directory 仍指
//   改名前死路径 → 前端渲染层按「session.directory === 当前目录」过滤 → 会话不可见(改回原名才回来)。
//   修法 = fromDirectory 数据自愈两级:① 重绑前缀重写(旧树→新树,保子目录)② 孤儿清扫(存量死目录
//   三态判定后扁平到当前 worktree)。本文件覆盖:改名跟随(git/非git)/ 存量孤儿 / 保守不动 / 往返。
import { describe, expect } from "bun:test"
import { Project } from "@/project/project"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { $ } from "bun"
import path from "path"
import { tmpdirScoped } from "../fixture/fixture"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2Bridge } from "@/event-v2-bridge"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { AppProcess } from "@opencode-ai/core/process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { healStaleSessionDirectories } from "@/project/session-dir-heal"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

const projectLayerWithFlag = (nonGitFolderIdentity: boolean) =>
  Project.layer.pipe(
    Layer.provide(RuntimeFlags.layer({ nonGitFolderIdentity })),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(ProjectV2.defaultLayer),
    Layer.provide(ProjectCopy.defaultLayer),
    Layer.provide(AppProcess.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Database.defaultLayer),
  )

const baseLayer = (flag: boolean) =>
  Layer.mergeAll(projectLayerWithFlag(flag), Database.defaultLayer, CrossSpawnSpawner.defaultLayer)

const itOn = testEffect(baseLayer(true))
const itOff = testEffect(baseLayer(false))

async function gitRepoWithCommit(dir: string) {
  await $`mkdir -p ${dir}`.quiet()
  await $`git init`.cwd(dir).quiet()
  await $`git -c user.email=t@example.com -c user.name=test commit --allow-empty -m init`.cwd(dir).quiet()
}

function seedSession(opts: { id: string; dir: string; project: string }) {
  const now = Date.now()
  return Database.Service.use(({ db }) =>
    db
      .insert(SessionTable)
      .values({
        id: opts.id as any,
        project_id: opts.project as any,
        slug: opts.id,
        directory: opts.dir as any,
        title: "heal-test",
        version: "0.0.0-test",
        time_created: now,
        time_updated: now,
      })
      .run()
      .pipe(Effect.orDie),
  )
}

function sessionDir(id: string) {
  return Database.Service.use(({ db }) =>
    db
      .select({ directory: SessionTable.directory })
      .from(SessionTable)
      .where(eq(SessionTable.id, id as any))
      .get()
      .pipe(
        Effect.orDie,
        Effect.map((row) => row?.directory),
      ),
  )
}

const sid = () => `ses_heal_${crypto.randomUUID().slice(0, 12)}`

function ensureGlobal() {
  const now = Date.now()
  return Database.Service.use(({ db }) =>
    db
      .insert(ProjectTable)
      .values({
        id: ProjectV2.ID.global,
        worktree: AbsolutePath.make("/"),
        time_created: now,
        time_updated: now,
        sandboxes: [],
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie),
  )
}

describe("session.directory 跟随项目身份自愈 (REQ-072 follow-up)", () => {
  itOff.live("git 彻底改名重开:重绑时 session.directory 前缀重写(根 + 子目录)", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const orig = path.join(root, "rtgit-orig")
      const renamed = path.join(root, "rtgit-totally-different-name")

      yield* Effect.promise(() => gitRepoWithCommit(orig))
      const first = yield* project.fromDirectory(orig)
      const worktree = first.project.worktree // 用 resolve 后的真实路径(避开 /var→/private/var symlink)
      const projectID = first.project.id

      yield* Effect.promise(() => $`mkdir -p ${path.join(worktree, "sub")}`.quiet())
      const sRoot = sid()
      const sSub = sid()
      yield* seedSession({ id: sRoot, dir: worktree, project: projectID })
      yield* seedSession({ id: sSub, dir: path.join(worktree, "sub"), project: projectID })

      yield* Effect.promise(() => $`mv ${orig} ${renamed}`.quiet())

      const second = yield* project.fromDirectory(renamed)
      expect(second.project.id).toBe(projectID)
      const newWorktree = second.project.worktree
      expect(newWorktree.endsWith("rtgit-totally-different-name")).toBe(true)

      expect(yield* sessionDir(sRoot)).toBe(newWorktree)
      expect(yield* sessionDir(sSub)).toBe(path.join(newWorktree, "sub"))
    }),
  )

  itOff.live("存量孤儿(错过重绑的死目录)打开项目即自愈到当前 worktree", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const dir = path.join(root, "live-project")

      yield* Effect.promise(() => gitRepoWithCommit(dir))
      const first = yield* project.fromDirectory(dir)
      const worktree = first.project.worktree
      const projectID = first.project.id

      // 模拟真机受害行:session.directory 指向一个从未被重绑覆盖、且磁盘上不存在的旧路径
      const legacy = sid()
      yield* seedSession({ id: legacy, dir: path.join(root, "long-gone-renamed-away"), project: projectID })

      // 正常重开(无重绑发生)→ 孤儿清扫应把死目录扁平到当前 worktree
      yield* project.fromDirectory(dir)
      expect(yield* sessionDir(legacy)).toBe(worktree)
    }),
  )

  itOff.live("保守不动:directory 指向仍存在的目录不清扫;global 项目的 session 不受邻居项目打开影响", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const dir = path.join(root, "proj")
      const other = path.join(root, "still-exists")

      yield* Effect.promise(() => gitRepoWithCommit(dir))
      yield* Effect.promise(() => $`mkdir -p ${other}`.quiet())
      const first = yield* project.fromDirectory(dir)
      const projectID = first.project.id

      // ① 同项目 session 指向另一个仍存在的目录(工作区/沙箱语义)→ 不动
      const alive = sid()
      yield* seedSession({ id: alive, dir: other, project: projectID })
      // ② global 项目 session 指向死目录 → 打开别的项目绝不波及(scope 按 project_id)
      yield* ensureGlobal()
      const globalOwned = sid()
      const deadDir = path.join(root, "dead-global-dir")
      yield* seedSession({ id: globalOwned, dir: deadDir, project: ProjectV2.ID.global })

      yield* project.fromDirectory(dir)
      expect(yield* sessionDir(alive)).toBe(other)
      expect(yield* sessionDir(globalOwned)).toBe(deadDir)
    }),
  )

  itOn.live("非git(flag on)彻底改名重开:锚身份保持 + session.directory 跟随", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const orig = path.join(root, "plain-orig")
      const renamed = path.join(root, "plain-totally-new-title")

      yield* Effect.promise(() => $`mkdir -p ${orig}`.quiet())
      const first = yield* project.fromDirectory(orig)
      const worktree = first.project.worktree
      const projectID = first.project.id
      expect(projectID).not.toBe(ProjectV2.ID.global) // flag on → 铸锚身份

      const s = sid()
      yield* seedSession({ id: s, dir: worktree, project: projectID })

      yield* Effect.promise(() => $`mv ${orig} ${renamed}`.quiet())
      const second = yield* project.fromDirectory(renamed)
      expect(second.project.id).toBe(projectID)
      expect(yield* sessionDir(s)).toBe(second.project.worktree)
    }),
  )

  itOff.live("heal 共享函数直测(Session.list 兜底路径契约):注入判定,死目录扁平、live/树内不动", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const dir = path.join(root, "list-heal")
      yield* Effect.promise(() => gitRepoWithCommit(dir))
      const first = yield* project.fromDirectory(dir)
      const worktree = first.project.worktree
      const projectID = first.project.id

      const dead = sid()
      const alive = sid()
      const under = sid()
      const deadDir = path.join(root, "dead-elsewhere")
      const aliveDir = path.join(root, "alive-elsewhere")
      yield* seedSession({ id: dead, dir: deadDir, project: projectID })
      yield* seedSession({ id: alive, dir: aliveDir, project: projectID })
      yield* seedSession({ id: under, dir: path.join(worktree, "nested"), project: projectID })

      yield* Database.Service.use(({ db }) =>
        healStaleSessionDirectories({
          db,
          projectID,
          worktree,
          confirmedMissing: (d) => Effect.succeed(d === deadDir), // 注入:仅 deadDir 判「确切不存在」
        }),
      )
      expect(yield* sessionDir(dead)).toBe(worktree) // 死目录 → 扁平到 worktree
      expect(yield* sessionDir(alive)).toBe(aliveDir) // 判定说还在 → 不动
      expect(yield* sessionDir(under)).toBe(path.join(worktree, "nested")) // 树内快路径 → 不动
    }),
  )

  itOff.live("改回原名往返:session.directory 跟着回来,始终可见", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const orig = path.join(root, "roundtrip-orig")
      const renamed = path.join(root, "roundtrip-renamed")

      yield* Effect.promise(() => gitRepoWithCommit(orig))
      const first = yield* project.fromDirectory(orig)
      const worktree = first.project.worktree
      const projectID = first.project.id

      const s = sid()
      yield* seedSession({ id: s, dir: worktree, project: projectID })

      yield* Effect.promise(() => $`mv ${orig} ${renamed}`.quiet())
      const second = yield* project.fromDirectory(renamed)
      expect(yield* sessionDir(s)).toBe(second.project.worktree)

      yield* Effect.promise(() => $`mv ${renamed} ${orig}`.quiet())
      const third = yield* project.fromDirectory(orig)
      expect(third.project.id).toBe(projectID)
      expect(yield* sessionDir(s)).toBe(third.project.worktree)
      expect(third.project.worktree).toBe(worktree)
    }),
  )
})
