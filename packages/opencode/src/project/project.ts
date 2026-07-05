import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { and, eq, sql } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectDirectoryTable, ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { WorkspaceTable } from "@opencode-ai/core/control-plane/workspace.sql"
import { Flag } from "@opencode-ai/core/flag/flag"
import { GlobalBus } from "@/bus/global"
import { which } from "@opencode-ai/core/util/which"
import { Command } from "@/command"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Layer, Scope, Context, Stream, Types, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppProcess } from "@opencode-ai/core/process"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AbsolutePath, NonNegativeInt, optionalOmitUndefined } from "@opencode-ai/core/schema"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { EventV2 } from "@opencode-ai/core/event"
// FORK: REQ-061 M5 三态重绑判定 [feat: stale-path-hardening]
import { isWorktreeConfirmedMissing, keepSandboxUnlessConfirmedGone } from "./project-rebind"
// FORK: REQ-069 非git 文件夹稳定身份 — 锚铸造/写侧编排 2026-07-05
import { mintId, writeAnchor, appendToInfoExclude, ANCHOR_DIR } from "@opencode-ai/core/project/anchor"

const ProjectVcs = Schema.Literal("git")

const ProjectIcon = Schema.Struct({
  url: optionalOmitUndefined(Schema.String),
  override: optionalOmitUndefined(Schema.String),
  color: optionalOmitUndefined(Schema.String),
})

const ProjectCommands = Schema.Struct({
  start: optionalOmitUndefined(
    Schema.String.annotate({ description: "Startup script to run when creating a new workspace (worktree)" }),
  ),
})

const ProjectTime = Schema.Struct({
  created: NonNegativeInt,
  updated: NonNegativeInt,
  initialized: optionalOmitUndefined(NonNegativeInt),
})

export const Info = Schema.Struct({
  id: ProjectV2.ID,
  worktree: Schema.String,
  vcs: optionalOmitUndefined(ProjectVcs),
  name: optionalOmitUndefined(Schema.String),
  icon: optionalOmitUndefined(ProjectIcon),
  commands: optionalOmitUndefined(ProjectCommands),
  time: ProjectTime,
  sandboxes: Schema.Array(Schema.String),
}).annotate({ identifier: "Project" })
export type Info = Types.DeepMutable<Schema.Schema.Type<typeof Info>>

export const Event = {
  Updated: EventV2.define({ type: "project.updated", schema: Info.fields }),
}

type Row = typeof ProjectTable.$inferSelect

export function fromRow(row: Row): Info {
  const icon =
    row.icon_url || row.icon_url_override || row.icon_color
      ? {
          url: row.icon_url ?? undefined,
          override: row.icon_url_override ?? undefined,
          color: row.icon_color ?? undefined,
        }
      : undefined
  return {
    id: row.id,
    worktree: row.worktree,
    vcs: row.vcs ? Schema.decodeUnknownSync(ProjectVcs)(row.vcs) : undefined,
    name: row.name ?? undefined,
    icon,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      initialized: row.time_initialized ?? undefined,
    },
    sandboxes: row.sandboxes,
    commands: row.commands ?? undefined,
  }
}

export const UpdateInput = Schema.Struct({
  projectID: ProjectV2.ID,
  name: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIcon),
  commands: Schema.optional(ProjectCommands),
})
export type UpdateInput = Types.DeepMutable<Schema.Schema.Type<typeof UpdateInput>>

export const UpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIcon),
  commands: Schema.optional(ProjectCommands),
}).annotate({ identifier: "ProjectUpdateInput" })
export type UpdatePayload = Types.DeepMutable<Schema.Schema.Type<typeof UpdatePayload>>

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Project.NotFoundError", {
  projectID: ProjectV2.ID,
}) {}

// ---------------------------------------------------------------------------
// Effect service
// ---------------------------------------------------------------------------

export interface Interface {
  /**
   * Per-instance setup. Subscribes to the `/init` slash command for the
   * current instance and stamps the project's initialized timestamp when it
   * fires. Subscription lifetime is tied to the per-instance state scope.
   */
  readonly init: () => Effect.Effect<void>
  readonly fromDirectory: (directory: string) => Effect.Effect<{ project: Info; sandbox: string }>
  readonly discover: (input: Info) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Info[]>
  readonly get: (id: ProjectV2.ID) => Effect.Effect<Info | undefined>
  readonly update: (input: UpdateInput) => Effect.Effect<Info, NotFoundError>
  readonly initGit: (input: { directory: string; project: Info }) => Effect.Effect<Info>
  readonly setInitialized: (id: ProjectV2.ID) => Effect.Effect<void>
  readonly sandboxes: (id: ProjectV2.ID) => Effect.Effect<string[]>
  readonly addSandbox: (id: ProjectV2.ID, directory: string) => Effect.Effect<void>
  readonly removeSandbox: (id: ProjectV2.ID, directory: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Project") {}

type GitResult = { code: number; text: string; stderr: string }

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const proc = yield* AppProcess.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const projectV2 = yield* ProjectV2.Service
    const projectCopy = yield* ProjectCopy.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const { db } = yield* Database.Service

    const git = Effect.fnUntraced(
      function* (args: string[], opts?: { cwd?: string }) {
        const handle = yield* spawner.spawn(
          ChildProcess.make("git", args, { cwd: opts?.cwd, extendEnv: true, stdin: "ignore" }),
        )
        const [text, stderr] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
          { concurrency: 2 },
        )
        const code = yield* handle.exitCode
        return { code, text, stderr } satisfies GitResult
      },
      Effect.scoped,
      Effect.catch(() => Effect.succeed({ code: 1, text: "", stderr: "" } satisfies GitResult)),
    )

    const emitUpdated = (data: Info) =>
      Effect.sync(() =>
        GlobalBus.emit("event", {
          directory: "global",
          project: data.id,
          payload: { type: Event.Updated.type, properties: data },
        }),
      )

    const fakeVcs = Schema.decodeUnknownSync(Schema.optional(ProjectVcs))(Flag.OPENCODE_FAKE_VCS)

    const scope = yield* Scope.Scope

    const migrateProjectId = Effect.fn("Project.migrateProjectId")(function* (
      oldID: ProjectV2.ID | undefined,
      newID: ProjectV2.ID,
    ) {
      if (!oldID) return
      if (oldID === ProjectV2.ID.global) return
      if (oldID === newID) return

      yield* db
        .transaction(
          (d) =>
            Effect.gen(function* () {
              const oldProject = yield* d.select().from(ProjectTable).where(eq(ProjectTable.id, oldID)).get()
              const newProject = yield* d.select().from(ProjectTable).where(eq(ProjectTable.id, newID)).get()
              if (oldProject && !newProject) {
                yield* d
                  .insert(ProjectTable)
                  .values({
                    ...oldProject,
                    id: newID,
                    time_updated: Date.now(),
                  })
                  .run()
              }

              yield* d
                .update(SessionTable)
                .set({ project_id: newID, time_updated: sql`${SessionTable.time_updated}` })
                .where(eq(SessionTable.project_id, oldID))
                .run()
              yield* d
                .update(WorkspaceTable)
                .set({ project_id: newID })
                .where(eq(WorkspaceTable.project_id, oldID))
                .run()

              if (oldProject) yield* d.delete(ProjectTable).where(eq(ProjectTable.id, oldID)).run()
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)
    })

    const saveProjectDirectory = Effect.fn("Project.saveProjectDirectory")(function* (input: {
      projectID: ProjectV2.ID
      directory: string
    }) {
      if (input.projectID === ProjectV2.ID.global) return
      const opened = AbsolutePath.make(FSUtil.resolve(input.directory))
      const type = yield* projectCopy.detect({ directory: opened })

      yield* db
        .transaction(
          (d) =>
            Effect.gen(function* () {
              const hasMain = yield* d
                .select({ directory: ProjectDirectoryTable.directory })
                .from(ProjectDirectoryTable)
                .where(
                  and(eq(ProjectDirectoryTable.project_id, input.projectID), eq(ProjectDirectoryTable.type, "main")),
                )
                .get()
              yield* d
                .insert(ProjectDirectoryTable)
                .values({ directory: opened, project_id: input.projectID, type: type ?? (hasMain ? "root" : "main") })
                .onConflictDoNothing()
                .run()
            }),
          { behavior: "immediate" },
        )
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("project directory persistence failed", { projectID: input.projectID, cause }),
          ),
        )
    })

    // FORK-BEGIN: REQ-069 M6 锚丢失软恢复 — 反查 ProjectDirectoryTable 2026-07-05
    // 治理: [override-blacklist: REQ-069 M6 软恢复] — 反查落 opencode 项目层 + core DB(黑名单);
    //       复用现有 ProjectDirectoryTable(saveProjectDirectory 已在写),不新建存储、不改 sql.ts schema、
    //       不加索引(表量级小,全表扫可接受,钉死5)。
    // 入参 opened = 已 resolve 的真实打开目录(绝对路径)。返回:命中且 project 行仍在 → 旧 id;否则 undefined。
    // main 优先:同目录可能落过多类型行(main/root/git_worktree),按 type=main 优先取,再回落任意类型。
    // 该 project 行必须仍存在(inner join 语义),否则复用一个已删 id 会造出悬空引用。
    const recoverAnchorFromDirectory = Effect.fn("Project.recoverAnchorFromDirectory")(function* (opened: string) {
      const rows = yield* db
        .select({ project_id: ProjectDirectoryTable.project_id, type: ProjectDirectoryTable.type })
        .from(ProjectDirectoryTable)
        .innerJoin(ProjectTable, eq(ProjectDirectoryTable.project_id, ProjectTable.id))
        .where(eq(ProjectDirectoryTable.directory, opened))
        .all()
        .pipe(Effect.orDie)
      if (rows.length === 0) return undefined
      // global 是特殊哨兵 id,不参与析出恢复(saveProjectDirectory 也对 global 早退不落行,理论上不会命中,防御性排除)
      const candidates = rows.filter((r) => r.project_id !== ProjectV2.ID.global)
      if (candidates.length === 0) return undefined
      const chosen = candidates.find((r) => r.type === "main") ?? candidates[0]
      yield* Effect.logInfo("anchor recovery: reusing project id from directory table", {
        directory: opened,
        projectID: chosen.project_id,
      })
      return ProjectV2.ID.make(chosen.project_id)
    })
    // FORK-END

    const fromDirectory = Effect.fn("Project.fromDirectory")(function* (directory: string) {
      yield* Effect.logInfo("fromDirectory", { directory })

      const data = yield* projectV2.resolve(AbsolutePath.make(directory))

      // FORK-BEGIN: REQ-069 非git 文件夹稳定身份 — fromDirectory 编排(唯一显式打开项目点) 2026-07-05
      // 治理: [override-blacklist: REQ-069 fromDirectory 编排] — fromDirectory 是 migrateProjectId/DB 持久化
      //       所在的唯一「显式打开项目」编排点,铸造触发与 flag 门控无法外置(B4/R1 裁决);写锚主体在 core
      //       anchor.ts(U2),此处仅编排注入。resolve 保持纯读,绝不 mint/writeAnchor。
      //
      // ① flag 门控(B4 裁决,编排层唯一门):flag 关时,对「!data.vcs 且 resolve 返回锚 id(非 global)」的目录,
      //    强制按 global 处理 —— 忽略锚 id、行为=改造前(id=global、worktree="/"),不写锚、不铸 id。
      const flagOn = flags.nonGitFolderIdentity
      const anchorGatedOut = !flagOn && !data.vcs && data.id !== ProjectV2.ID.global
      // ② 铸锚判定钉死:flag 开 && data.vcs === undefined && data.id === global(= 无锚非git;
      //    git init 未 commit 的目录 data.vcs 有值,绝不触发 mint)→ mintId() → 析出行 worktree = data.directory
      //    (真实目录,B5 裁决:建行即真实 worktree,不沿用 global 的 "/"、不依赖盘根重绑机制)。
      const shouldMint = flagOn && data.vcs === undefined && data.id === ProjectV2.ID.global
      // ②-M6 锚丢失软恢复(REQ-069 M6):进入 mint 判定前,先反查 ProjectDirectoryTable —— 若该打开目录
      //    历史上曾以某 project_id(type=main 优先)落过 directory 行、且该 project 行仍在,说明「同一目录
      //    只是锚文件丢了」(用户误删 .deskfox / 清理工具扫掉)。此时沿用旧 id(不 mint)、重写锚、发恢复日志,
      //    旧会话不失联。未命中(全新目录 / 旧 project 行已删)→ 正常 mint。
      //    仅全表小量级扫,不改 sql.ts schema、不加索引(钉死5)。
      //    ⚠️ 边界(可接受,与 git previous 缓存语义一致):同一磁盘路径若已被无关新文件夹替换,反查会误复用旧 id。
      const recoveredID = shouldMint
        ? yield* recoverAnchorFromDirectory(AbsolutePath.make(FSUtil.resolve(directory)))
        : undefined
      const mintedID = shouldMint ? (recoveredID ?? mintId()) : undefined

      // 有效身份:mint 时用新 id;flag 关门控出时强制 global;否则 resolve 返回的 id。
      const effectiveID = mintedID ?? (anchorGatedOut ? ProjectV2.ID.global : ProjectV2.ID.make(data.id))
      // 门控出时 previous 也须回退(不迁移锚 id 对应的旧行);mint 时无 previous(全新身份)。
      const effectivePrevious = anchorGatedOut || mintedID ? undefined : data.previous
      // 有效目录:mint 时 resolve 返 global → data.directory 是盘根 "/",此处必须用真实打开路径
      //   (B5 裁决:析出行建行即真实 worktree)。非 mint 沿用 resolve 的 data.directory(git repo 根 / 有锚真实目录)。
      const effectiveDir = mintedID ? AbsolutePath.make(FSUtil.resolve(directory)) : data.directory
      // worktree 基线:global(且非git)→ 盘根 "/";析出行(mint)/有锚/git → 真实目录。
      const worktree = effectiveID === ProjectV2.ID.global && !data.vcs ? "/" : effectiveDir

      // Phase 2: upsert
      const projectID = effectiveID
      yield* migrateProjectId(effectivePrevious ? ProjectV2.ID.make(effectivePrevious) : undefined, projectID)
      // FORK-END
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get().pipe(Effect.orDie)
      const existing = row
        ? fromRow(row)
        : {
            id: projectID,
            worktree,
            vcs: data.vcs?.type ?? fakeVcs,
            sandboxes: [] as string[],
            time: { created: Date.now(), updated: Date.now() },
          }

      if (flags.experimentalIconDiscovery) yield* discover(existing).pipe(Effect.ignore, Effect.forkIn(scope))

      // FORK: REQ-061/064 — 磁盘改名/移动后,DB 里 existing.worktree 仍指向已不存在的旧路径,
      // 侧栏据此调 /file?directory=旧路径 → 503、且显示旧名。当用户用文件夹选择器重新打开该项目时
      // (git-id 命中同一行),按实际打开路径 data.directory 重绑 worktree —— 仅当旧 worktree 磁盘上
      // 确已不存在时才重绑,正常项目 / 打开沙箱子目录(旧 worktree 仍在)行为不变,不误伤。2026-06-17
      // FORK: REQ-061 M5 三态 — 仅「确切探到 worktree 不存在(ENOENT)」才判 missing 并重绑;检查出错
      // (EACCES/网络盘离线/U盘暂拔/超时)保守当作仍存在、不重绑。原 orElseSucceed(()=>false) 会把检查
      // 出错也误判 missing → 把暂不可达的有效 worktree 改掉。判定抽到 isWorktreeConfirmedMissing 便于单测。
      // 2026-06-25 [feat: stale-path-hardening]
      // FORK: REQ-069 — 用 effectiveDir(mint 时为真实打开路径,非 mint === data.directory)替代 data.directory,
      //   保证析出行重绑/沙箱/迁移全部锚在真实目录而非盘根 "/"。非 mint 路径与改造前 bit-identical。2026-07-05
      const existingWorktreeMissing =
        projectID !== ProjectV2.ID.global &&
        existing.worktree !== effectiveDir &&
        (yield* isWorktreeConfirmedMissing(fs.exists(existing.worktree)))
      if (existingWorktreeMissing)
        yield* Effect.logInfo("rebinding stale worktree", { from: existing.worktree, to: effectiveDir })

      const result: Info = {
        ...existing,
        worktree:
          projectID === ProjectV2.ID.global ? worktree : existingWorktreeMissing ? effectiveDir : existing.worktree,
        vcs: data.vcs?.type ?? fakeVcs,
        time: { ...existing.time, updated: Date.now() },
      }
      if (
        projectID !== ProjectV2.ID.global &&
        effectiveDir !== result.worktree &&
        !result.sandboxes.includes(effectiveDir)
      )
        result.sandboxes.push(effectiveDir)
      // FORK: REQ-064 加固 — 沙箱存在性检查出错(离线盘/U盘暂拔)保守保留,不再 Effect.orDie→update 500
      // (与上方 worktree 三态判定一致;判定抽到 keepSandboxUnlessConfirmedGone 便于单测)。
      // 2026-06-26 [feat: stale-path-hardening]
      result.sandboxes = yield* Effect.forEach(
        result.sandboxes,
        (s) => keepSandboxUnlessConfirmedGone(s, fs.exists(s)),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))

      yield* db
        .insert(ProjectTable)
        .values({
          id: result.id,
          worktree: AbsolutePath.make(result.worktree),
          vcs: result.vcs ?? null,
          name: result.name,
          icon_url: result.icon?.url,
          icon_url_override: result.icon?.override,
          icon_color: result.icon?.color,
          time_created: result.time.created,
          time_updated: result.time.updated,
          time_initialized: result.time.initialized,
          sandboxes: result.sandboxes.map((sandbox) => AbsolutePath.make(sandbox)),
          commands: result.commands,
        })
        .onConflictDoUpdate({
          target: ProjectTable.id,
          set: {
            worktree: AbsolutePath.make(result.worktree),
            vcs: result.vcs ?? null,
            name: result.name,
            icon_url: result.icon?.url,
            icon_url_override: result.icon?.override,
            icon_color: result.icon?.color,
            time_updated: result.time.updated,
            time_initialized: result.time.initialized,
            sandboxes: result.sandboxes.map((sandbox) => AbsolutePath.make(sandbox)),
            commands: result.commands,
          },
        })
        .run()
        .pipe(Effect.orDie)

      if (projectID !== ProjectV2.ID.global) {
        yield* db
          .update(SessionTable)
          .set({ project_id: projectID })
          .where(and(eq(SessionTable.project_id, ProjectV2.ID.global), eq(SessionTable.directory, effectiveDir)))
          .run()
          .pipe(Effect.orDie)
      }

      yield* saveProjectDirectory({
        projectID,
        directory: effectiveDir,
      })

      yield* emitUpdated(result)

      // FORK-BEGIN: REQ-069 两路写锚(连续性令牌) 2026-07-05
      // flag 开且 projectID !== global 时,git/非git 分支都写锚(effectiveDir ← projectID);写锚失败降级不抛(U2)。
      // git 分支:现有 projectV2.commit({store,id}) 保持不变,并加 appendToInfoExclude 防污染 git status。
      if (flagOn && projectID !== ProjectV2.ID.global) {
        yield* writeAnchor(effectiveDir, projectID).pipe(Effect.provideService(FSUtil.Service, fs))
      }
      if (projectID !== ProjectV2.ID.global && data.vcs?.type === "git") {
        yield* projectV2.commit({ store: data.vcs.store, id: data.id })
        if (flagOn)
          yield* appendToInfoExclude(data.vcs.store, `${ANCHOR_DIR}/`).pipe(
            Effect.provideService(FSUtil.Service, fs),
          )
      }
      // FORK-END
      return { project: result, sandbox: data.vcs ? data.directory : worktree }
    })

    const discover = Effect.fn("Project.discover")(function* (input: Info) {
      if (input.vcs !== "git") return
      if (input.icon?.override) return
      if (input.icon?.url) return

      const matches = yield* fs
        .glob("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
          cwd: input.worktree,
          absolute: true,
          include: "file",
        })
        .pipe(Effect.orDie)
      const shortest = matches.sort((a, b) => a.length - b.length)[0]
      if (!shortest) return

      const buffer = yield* fs.readFile(shortest).pipe(Effect.orDie)
      const base64 = Buffer.from(buffer).toString("base64")
      const mime = FSUtil.mimeType(shortest)
      const url = `data:${mime};base64,${base64}`
      yield* update({ projectID: input.id, icon: { url } }).pipe(
        Effect.catchTag("Project.NotFoundError", () => Effect.void),
      )
    })

    const list = Effect.fn("Project.list")(function* () {
      return (yield* db.select().from(ProjectTable).all().pipe(Effect.orDie)).map(fromRow)
    })

    const get = Effect.fn("Project.get")(function* (id: ProjectV2.ID) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get().pipe(Effect.orDie)
      return row ? fromRow(row) : undefined
    })

    const update = Effect.fn("Project.update")(function* (input: UpdateInput) {
      const result = yield* db
        .update(ProjectTable)
        .set({
          name: input.name,
          icon_url: input.icon?.url,
          icon_url_override: input.icon?.override,
          icon_color: input.icon?.color,
          commands: input.commands,
          time_updated: Date.now(),
        })
        .where(eq(ProjectTable.id, input.projectID))
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (!result) return yield* new NotFoundError({ projectID: input.projectID })
      const data = fromRow(result)
      yield* emitUpdated(data)
      return data
    })

    const initGit = Effect.fn("Project.initGit")(function* (input: { directory: string; project: Info }) {
      if (input.project.vcs === "git") return input.project
      if (!(yield* Effect.sync(() => which("git")))) throw new Error("Git is not installed")
      const result = yield* git(["init", "--quiet"], { cwd: input.directory })
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.text.trim() || "Failed to initialize git repository")
      }
      const { project } = yield* fromDirectory(input.directory)
      return project
    })

    const setInitialized = Effect.fn("Project.setInitialized")(function* (id: ProjectV2.ID) {
      yield* db
        .update(ProjectTable)
        .set({ time_initialized: Date.now() })
        .where(eq(ProjectTable.id, id))
        .run()
        .pipe(Effect.orDie)
    })

    const initState = yield* InstanceState.make(
      Effect.fn("Project.initState")(function* (ctx) {
        const unsubscribe = yield* events.listen((event) => {
          if (event.type !== Command.Event.Executed.type || event.location?.directory !== ctx.directory)
            return Effect.void
          const data = event.data as EventV2.Data<typeof Command.Event.Executed>
          return data.name === Command.Default.INIT ? setInitialized(ctx.project.id) : Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)
      }),
    )

    const init = Effect.fn("Project.init")(function* () {
      yield* InstanceState.get(initState)
    })

    const sandboxes = Effect.fn("Project.sandboxes")(function* (id: ProjectV2.ID) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get().pipe(Effect.orDie)
      if (!row) return []
      const data = fromRow(row)
      return yield* Effect.forEach(
        data.sandboxes,
        (dir) =>
          fs.isDir(dir).pipe(
            Effect.orDie,
            Effect.map((ok) => (ok ? dir : undefined)),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((arr) => arr.filter((x): x is string => x !== undefined)))
    })

    const addSandbox = Effect.fn("Project.addSandbox")(function* (id: ProjectV2.ID, directory: string) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get().pipe(Effect.orDie)
      if (!row) throw new Error(`Project not found: ${id}`)
      const sandbox = AbsolutePath.make(directory)
      const sboxes = [...row.sandboxes]
      if (!sboxes.includes(sandbox)) sboxes.push(sandbox)
      const result = yield* db
        .update(ProjectTable)
        .set({ sandboxes: sboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    const removeSandbox = Effect.fn("Project.removeSandbox")(function* (id: ProjectV2.ID, directory: string) {
      const row = yield* db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get().pipe(Effect.orDie)
      if (!row) throw new Error(`Project not found: ${id}`)
      const sandbox = AbsolutePath.make(directory)
      const sboxes = row.sandboxes.filter((s) => s !== sandbox)
      const result = yield* db
        .update(ProjectTable)
        .set({ sandboxes: sboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get()
        .pipe(Effect.orDie)
      if (!result) throw new Error(`Project not found: ${id}`)
      yield* emitUpdated(fromRow(result))
    })

    return Service.of({
      init,
      fromDirectory,
      discover,
      list,
      get,
      update,
      initGit,
      setInitialized,
      sandboxes,
      addSandbox,
      removeSandbox,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(EventV2Bridge.defaultLayer),
  Layer.provide(ProjectV2.defaultLayer),
  Layer.provide(ProjectCopy.defaultLayer),
  Layer.provide(AppProcess.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Database.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export const use = serviceUse(Service)

export const node = LayerNode.make(layer, [
  FSUtil.node,
  AppProcess.node,
  CrossSpawnSpawner.node,
  ProjectV2.node,
  ProjectCopy.node,
  EventV2Bridge.node,
  RuntimeFlags.node,
  Database.node,
])

export * as Project from "./project"
