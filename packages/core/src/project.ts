export * as ProjectV2 from "./project"
export * as Project from "./project"

import { Context, Effect, Layer, Schema } from "effect"
import path from "path"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { LayerNode } from "./effect/layer-node"
import { Hash } from "./util/hash"
import { ProjectDirectoryTable } from "./project/sql"
// FORK: REQ-069 锚读桥接 — resolve 读锚以支撑非 git 文件夹稳定身份 2026-07-05
import { readAnchor } from "./project/anchor"
import { ProjectDirectories } from "./project/directories"
import { ProjectSchema } from "./project/schema"

export const ID = ProjectSchema.ID
export type ID = ProjectSchema.ID

export const Vcs = ProjectSchema.Vcs
export type Vcs = ProjectSchema.Vcs

export class Info extends Schema.Class<Info>("Project.Info")({
  id: ID,
}) {}

export const DirectoriesInput = ProjectDirectories.ListInput
export type DirectoriesInput = typeof DirectoriesInput.Type

export const Directories = ProjectDirectories.ListOutput
export type Directories = typeof Directories.Type

export interface Resolved {
  readonly previous?: ID
  readonly id: ID
  readonly directory: AbsolutePath
  readonly vcs?: Vcs
}

export interface Interface {
  readonly directories: (input: DirectoriesInput) => Effect.Effect<Directories>
  readonly resolve: (input: AbsolutePath) => Effect.Effect<Resolved>
  /**
   * Temporary bridge method for writing the resolved project ID to the repo-local cache.
   *
   * This exists while the old opencode project service and this core project
   * service work together: core resolves the ID, while the old service still owns
   * database migration and persistence. The old service should call this after it
   * finishes migrating from `resolve().previous` to `resolve().id`; once project
   * persistence moves into core, this separate bridge method can go away.
   */
  readonly commit: (input: { store: AbsolutePath; id: ID }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectV2") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const git = yield* Git.Service
    const projectDirectories = yield* ProjectDirectories.Service

    const directories = Effect.fn("Project.directories")(function* (input: DirectoriesInput) {
      return yield* projectDirectories.list(input.projectID)
    })

    const cached = Effect.fnUntraced(function* (dir: string) {
      return yield* fs.readFileString(path.join(dir, "opencode")).pipe(
        Effect.map((value) => value.trim()),
        Effect.map((value) => (value ? ID.make(value) : undefined)),
        Effect.catch(() => Effect.succeed(undefined)),
      )
    })

    const remote = Effect.fnUntraced(function* (repo: Git.Repo) {
      const origin = yield* git.remote(repo)
      if (!origin) return undefined
      const normalized = url(origin)
      if (!normalized) return undefined
      return ID.make(Hash.fast(`git-remote:${normalized}`))
    })

    function url(input: string) {
      const value = input.trim()
      if (!value) return undefined

      try {
        const parsed = new URL(value)
        if (parsed.protocol === "file:") return undefined
        return parts(parsed.hostname, parsed.pathname)
      } catch {
        const scp = value.match(/^([^@/:]+@)?([^/:]+):(.+)$/)
        if (scp) return parts(scp[2], scp[3])
        return undefined
      }
    }

    function parts(host: string, name: string) {
      const pathname = name
        .replace(/^\/+/, "")
        .replace(/\.git\/?$/, "")
        .replace(/\/+$/, "")
      if (!host || !pathname) return undefined
      return `${host.toLowerCase()}/${pathname}`
    }

    const root = Effect.fnUntraced(function* (repo: Git.Repo) {
      const root = (yield* git.roots(repo))[0]
      return root ? ID.make(root) : undefined
    })

    const resolve = Effect.fn("Project.resolve")(function* (input: AbsolutePath) {
      // FORK-BEGIN: REQ-069 锚读+桥接优先级 2026-07-05
      // resolve 无条件读锚(B4 裁决:flag 门控不下沉 core,core 无法访问 opencode 的 RuntimeFlags;
      // 「flag 关时项目身份仍按 global」由 U4 编排层强制)。resolve 保持纯读,绝不 mintId/writeAnchor(铸写在 U4)。
      // 用 layer 闭包内已解析的 fs 满足 readAnchor 的 FSUtil.Service 需求(与 cached/commit 同源)。
      const anchor = yield* readAnchor(input).pipe(Effect.provideService(FSUtil.Service, fs))

      const repo = yield* git.find(input)
      if (!repo) {
        // 【有锚】返锚 id + 真实打开目录(B2 裁决:真实目录修复仅在绑定锚存在时生效,不无条件生效)
        if (anchor) return { previous: anchor, id: anchor, directory: input, vcs: undefined }
        // 【无锚】bit-identical 现状 — 保证 session.ts:204 / location.ts:37 / move-session.ts:81-82 三个
        // 非 fromDirectory 调用方在「从未开过 flag」的存量环境零行为变化
        return { id: ID.global, directory: AbsolutePath.make(path.parse(input).root), vcs: undefined }
      }

      // git 分支:previous 链 = cached(.git/opencode) ?? 锚id;
      // id 全序 remote > .git/opencode(cached) > 锚id > root(即 remote ?? cached ?? 锚id ?? root)。
      // .git/opencode 与锚不一致时 cached 优先(钉死3);git init 未 commit(remote/cached/root 全无)有锚 → id=锚id 不掉 global。
      const cachedId = yield* cached(repo.store)
      const previous = cachedId ?? anchor
      const id = (yield* remote(repo)) ?? cachedId ?? anchor ?? (yield* root(repo))
      return {
        previous,
        id: id ?? ID.global,
        directory: repo.directory,
        vcs: { type: "git" as const, store: repo.store },
      }
      // FORK-END
    })

    const commit = Effect.fn("Project.commit")(function* (input: { store: AbsolutePath; id: ID }) {
      yield* fs.writeFileString(path.join(input.store, "opencode"), input.id).pipe(Effect.ignore)
    })

    return Service.of({ directories, resolve, commit })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Git.defaultLayer),
  Layer.provideMerge(ProjectDirectories.defaultLayer),
)
export const node = LayerNode.make(layer, [FSUtil.node, Git.node, ProjectDirectories.node])
