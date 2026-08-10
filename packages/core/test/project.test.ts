import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Effect, Layer, Schema } from "effect"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Git } from "@opencode-ai/core/git"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Hash } from "@opencode-ai/core/util/hash"
import { ProjectDirectories } from "@opencode-ai/core/project/directories"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const databaseLayer = Database.layerFromPath(":memory:")
const directoriesLayer = ProjectDirectories.layer.pipe(Layer.provide(databaseLayer))
const it = testEffect(
  Layer.mergeAll(
    ProjectV2.layer.pipe(
      Layer.provide(FSUtil.defaultLayer),
      Layer.provide(Git.defaultLayer),
      Layer.provide(directoriesLayer),
      Layer.provide(databaseLayer),
    ),
    databaseLayer,
    directoriesLayer,
  ),
)

function remoteID(remote: string) {
  return ProjectV2.ID.make(Hash.fast(`git-remote:${remote}`))
}

function abs(value: string) {
  return AbsolutePath.make(value)
}

function real(value: string) {
  return Effect.promise(() => fs.realpath(value)).pipe(Effect.map((value) => AbsolutePath.make(value)))
}

async function initRepo(dir: string, opts?: { commit?: boolean; remote?: string }) {
  await $`git init`.cwd(dir).quiet()
  await $`git config core.fsmonitor false`.cwd(dir).quiet()
  await $`git config commit.gpgsign false`.cwd(dir).quiet()
  await $`git config user.email test@opencode.test`.cwd(dir).quiet()
  await $`git config user.name Test`.cwd(dir).quiet()
  if (opts?.commit) await $`git commit --allow-empty -m root`.cwd(dir).quiet()
  if (opts?.remote) await $`git remote add origin ${opts.remote}`.cwd(dir).quiet()
}

async function rootCommit(dir: string) {
  return (await $`git rev-list --max-parents=0 HEAD`.cwd(dir).text()).trim()
}

// REQ-069: 预置锚文件 <dir>/.deskfox/id(下方 resolve 系列 anchor 测试共用)
async function writeAnchorFile(dir: string, id: string) {
  await fs.mkdir(path.join(dir, ".deskfox"), { recursive: true })
  await Bun.write(path.join(dir, ".deskfox", "id"), id + "\n")
}

describe("ProjectV2.resolve", () => {
  it.live("returns global for non-git directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make("global"))
      expect(path.resolve(result.directory)).toBe(path.parse(tmp.path).root)
      expect(result.previous).toBeUndefined()
      expect(result.vcs).toBeUndefined()
    }),
  )

  it.live("returns git global for repo with no commits and no remote", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make("global"))
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(result.previous).toBeUndefined()
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("falls back to root commit when origin is missing", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(result.previous).toBeUndefined()
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("prefers normalized origin over root commit", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:Acme/App.git" }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(remoteID("github.com/Acme/App"))
      expect(result.id).not.toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
      expect(result.directory).toBe(yield* real(tmp.path))
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("normalizes ssh and https remotes to the same id", () =>
    Effect.gen(function* () {
      const ssh = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const https = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(ssh.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      yield* Effect.promise(() => initRepo(https.path, { commit: true, remote: "https://github.com/owner/repo.git" }))
      const project = yield* ProjectV2.Service

      const a = yield* project.resolve(abs(ssh.path))
      const b = yield* project.resolve(abs(https.path))

      expect(a.id).toBe(remoteID("github.com/owner/repo"))
      expect(b.id).toBe(a.id)
    }),
  )

  it.live("ignores file remotes and falls back to root commit", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: `file://${tmp.path}` }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
    }),
  )

  it.live("returns previous cached id from common dir", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, ".git", "opencode"), "old-id"))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.previous).toBe(ProjectV2.ID.make("old-id"))
      expect(result.id).toBe(remoteID("github.com/owner/repo"))
    }),
  )

  it.live("does not write the cache while resolving", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      const project = yield* ProjectV2.Service

      yield* project.resolve(abs(tmp.path))

      expect(yield* Effect.promise(() => Bun.file(path.join(tmp.path, ".git", "opencode")).exists())).toBe(false)
    }),
  )

  it.live("resolves from nested directories to repo root", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true }))
      yield* Effect.promise(() => fs.mkdir(path.join(tmp.path, "a", "b"), { recursive: true }))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(path.join(tmp.path, "a", "b")))

      expect(result.directory).toBe(yield* real(tmp.path))
    }),
  )

  it.live("linked worktree returns opened worktree directory and previous from common dir", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      const worktree = `${tmp.path}-worktree`
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => $`rm -rf ${worktree}`.quiet().nothrow()).pipe(Effect.ignore),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:owner/repo.git" }))
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, ".git", "opencode"), "old-id"))
      yield* Effect.promise(() => $`git worktree add ${worktree} -b test-${Date.now()}`.cwd(tmp.path).quiet())
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(worktree))

      expect(result.directory).toBe(yield* real(worktree))
      expect(result.previous).toBe(ProjectV2.ID.make("old-id"))
      expect(result.id).toBe(remoteID("github.com/owner/repo"))
      expect(result.vcs?.type).toBe("git")
    }),
  )

  // ─── REQ-069 锚读桥接 ─────────────────────────────────────────────────────
  it.live("non-git anchored directory returns anchor id, previous, and real directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => writeAnchorFile(tmp.path, "fld_anchor1"))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make("fld_anchor1"))
      expect(result.previous).toBe(ProjectV2.ID.make("fld_anchor1"))
      // 真实打开目录(非盘根),不做 realpath 归一(resolve 直接返 input)
      expect(result.directory).toBe(abs(tmp.path))
      expect(result.vcs).toBeUndefined()
    }),
  )

  it.live("git repo with no remote and no cache falls back to anchor id", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true }))
      yield* Effect.promise(() => writeAnchorFile(tmp.path, "fld_gitanchor"))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      // 全序 remote > cached > 锚id > root:无 remote 无 cached → 锚 id 胜出(压过 root commit)
      expect(result.id).toBe(ProjectV2.ID.make("fld_gitanchor"))
      expect(result.id).not.toBe(ProjectV2.ID.make(yield* Effect.promise(() => rootCommit(tmp.path))))
      expect(result.previous).toBe(ProjectV2.ID.make("fld_gitanchor"))
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("cache takes precedence over anchor when they disagree", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true }))
      yield* Effect.promise(() => Bun.write(path.join(tmp.path, ".git", "opencode"), "cached-id"))
      yield* Effect.promise(() => writeAnchorFile(tmp.path, "fld_anchor2"))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      // .git/opencode 与锚不一致 → cached 优先(钉死3)
      expect(result.id).toBe(ProjectV2.ID.make("cached-id"))
      expect(result.previous).toBe(ProjectV2.ID.make("cached-id"))
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("git init without commit and anchor present does not fall to global", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      // 无 commit(root 全无)、无 remote、无 cached → 只剩锚
      yield* Effect.promise(() => initRepo(tmp.path))
      yield* Effect.promise(() => writeAnchorFile(tmp.path, "fld_nocommit"))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      expect(result.id).toBe(ProjectV2.ID.make("fld_nocommit"))
      expect(result.id).not.toBe(ProjectV2.ID.make("global"))
      expect(result.previous).toBe(ProjectV2.ID.make("fld_nocommit"))
      expect(result.vcs?.type).toBe("git")
    }),
  )

  it.live("remote wins over anchor when both present", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir()),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* Effect.promise(() => initRepo(tmp.path, { commit: true, remote: "git@github.com:Acme/App.git" }))
      yield* Effect.promise(() => writeAnchorFile(tmp.path, "fld_anchor3"))
      const project = yield* ProjectV2.Service

      const result = yield* project.resolve(abs(tmp.path))

      // 全序最高位 remote 胜出(压过锚)
      expect(result.id).toBe(remoteID("github.com/Acme/App"))
      expect(result.id).not.toBe(ProjectV2.ID.make("fld_anchor3"))
      expect(result.vcs?.type).toBe("git")
    }),
  )
})
