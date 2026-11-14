import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { parsePatch } from "diff"
import { Deferred, Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import {
  disposeAllInstances,
  provideInstance,
  testInstanceStoreLayer,
  TestInstance,
  tmpdirScoped,
} from "../fixture/fixture"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Git } from "../../src/git"
import { Vcs } from "@/project/vcs"
import { testEffect } from "../lib/effect"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const weird = process.platform === "win32" ? "space file.txt" : "tab\tfile.txt"

const layer = LayerNode.compile(
  LayerNode.group([Vcs.node, Git.node, EventV2Bridge.node, FSUtil.node, CrossSpawnSpawner.node]),
)
const it = testEffect(layer)
const worktreeIt = testEffect(Layer.mergeAll(layer, testInstanceStoreLayer))

const git = Effect.fn("VcsTest.git")(function* (cwd: string, args: string[]) {
  const result = yield* Git.Service.use((git) => git.run(args, { cwd }))
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString("utf8")}`)
})

const write = Effect.fn("VcsTest.write")(function* (file: string, content: string) {
  yield* FSUtil.Service.use((fs) => fs.writeWithDirs(file, content))
})

const remove = Effect.fn("VcsTest.remove")(function* (file: string) {
  yield* FSUtil.Service.use((fs) => fs.remove(file))
})

const symlink = (target: string, file: string) => Effect.promise(() => fs.symlink(target, file))

const init = Effect.fn("VcsTest.init")(function* () {
  const vcs = yield* Vcs.Service
  yield* vcs.init()
  return vcs
})

const nextBranchUpdate = Effect.fn("VcsTest.nextBranchUpdate")(function* () {
  const events = yield* EventV2Bridge.Service
  const updated = yield* Deferred.make<string | undefined>()

  const off = yield* events.listen((event) => {
    if (event.type === Vcs.Event.BranchUpdated.type)
      Deferred.doneUnsafe(updated, Effect.succeed((event.data as typeof Vcs.Event.BranchUpdated.data.Type).branch))
    return Effect.void
  })
  yield* Effect.addFinalizer(() => off)

  return updated
})

const publishHeadChangeUntil = Effect.fn("VcsTest.publishHeadChangeUntil")(function* (
  pending: Deferred.Deferred<string | undefined>,
  head: string,
) {
  const events = yield* EventV2Bridge.Service
  for (let i = 0; i < 50; i++) {
    yield* events.publish(Watcher.Event.Updated, { file: head, event: "change" })
    if (yield* Deferred.isDone(pending)) return
    yield* Effect.sleep("10 millis")
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Vcs", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  it.instance(
    "branch() returns current branch name",
    () =>
      Effect.gen(function* () {
        const vcs = yield* init()
        const branch = yield* vcs.branch()

        expect(branch).toBeDefined()
        expect(typeof branch).toBe("string")
      }),
    { git: true },
  )

  it.instance("branch() returns undefined for non-git directories", () =>
    Effect.gen(function* () {
      const vcs = yield* init()
      const branch = yield* vcs.branch()

      expect(branch).toBeUndefined()
    }),
  )

  it.instance(
    "publishes BranchUpdated when .git/HEAD changes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const branch = `test-${Math.random().toString(36).slice(2)}`
        yield* git(test.directory, ["branch", branch])

        const vcs = yield* init()
        yield* vcs.branch()
        const pending = yield* nextBranchUpdate()

        const head = path.join(test.directory, ".git", "HEAD")
        yield* write(head, `ref: refs/heads/${branch}\n`)
        yield* publishHeadChangeUntil(pending, head)

        const updated = yield* Deferred.await(pending).pipe(Effect.timeout("2 seconds"))
        expect(updated).toBe(branch)
      }),
    { git: true },
  )

  it.instance(
    "branch() reflects the new branch after HEAD change",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const branch = `test-${Math.random().toString(36).slice(2)}`
        yield* git(test.directory, ["branch", branch])

        const vcs = yield* init()
        yield* vcs.branch()
        const pending = yield* nextBranchUpdate()

        const head = path.join(test.directory, ".git", "HEAD")
        yield* write(head, `ref: refs/heads/${branch}\n`)
        yield* publishHeadChangeUntil(pending, head)
        yield* Deferred.await(pending).pipe(Effect.timeout("2 seconds"))

        const current = yield* vcs.branch()
        expect(current).toBe(branch)
      }),
    { git: true },
  )
})

describe("Vcs diff", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  it.instance(
    "defaultBranch() falls back to main",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* git(test.directory, ["branch", "-M", "main"])

        const vcs = yield* init()
        const branch = yield* vcs.defaultBranch()

        expect(branch).toBe("main")
      }),
    { git: true },
  )

  it.instance(
    "defaultBranch() uses init.defaultBranch when available",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* git(test.directory, ["branch", "-M", "trunk"])
        yield* git(test.directory, ["config", "init.defaultBranch", "trunk"])

        const vcs = yield* init()
        const branch = yield* vcs.defaultBranch()

        expect(branch).toBe("trunk")
      }),
    { git: true },
  )

  worktreeIt.live("detects current branch from the active worktree", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ git: true })
      const wt = yield* tmpdirScoped()
      yield* git(tmp, ["branch", "-M", "main"])
      const dir = path.join(wt, "feature")
      yield* git(tmp, ["worktree", "add", "-b", "feature/test", dir, "HEAD"])

      const [branch, base] = yield* Effect.gen(function* () {
        const vcs = yield* init()
        return yield* Effect.all([vcs.branch(), vcs.defaultBranch()], { concurrency: 2 })
      }).pipe(provideInstance(dir))

      expect(branch).toBeDefined()
      expect(branch).toBe("feature/test")
      expect(base).toBe("main")
    }),
  )

  it.instance(
    "diff('git') returns uncommitted changes",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, "file.txt"), "original\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "add file"])
        yield* write(path.join(test.directory, "file.txt"), "changed\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")

        expect(diff).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file: "file.txt",
              status: "modified",
            }),
          ]),
        )
        expect(diff.find((item) => item.file === "file.txt")?.patch).toContain("diff --git")
      }),
    { git: true },
  )

  // FORK: protect Windows diff latency while preserving Git's patch output [feat: deskfox-vcs-refresh-overload]
  it.instance(
    "diff('git') batches untracked files without touching the user's index",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const directory = instance.directory
        const commands = yield* Git.Service
        const trace = path.join(directory, ".git", "qa-trace.jsonl")
        const index = path.join(directory, ".git", "index")
        const objects = path.join(directory, ".git", "objects")
        yield* write(path.join(directory, ".gitattributes"), "*.dat -diff\n")
        yield* write(path.join(directory, ".gitignore"), "ignored/\n")
        yield* write(path.join(directory, "ignored", "tracked.txt"), "tracked\n")
        yield* git(directory, ["add", ".gitattributes", ".gitignore"])
        yield* git(directory, ["add", "-f", "ignored/tracked.txt"])
        yield* git(directory, ["commit", "--no-gpg-sign", "-m", "track ignored sample"])
        yield* git(directory, ["rm", "ignored/tracked.txt"])
        yield* write(path.join(directory, "ignored", "skip.txt"), "ignored\n")
        const names = ["space 中文 %.txt", "empty.txt", "binary.dat", "hunk.txt"]
        yield* write(path.join(directory, names[0]), "without final newline")
        yield* write(path.join(directory, names[1]), "")
        yield* write(path.join(directory, names[2]), "Git attribute forces binary\n")
        yield* write(path.join(directory, names[3]), "one\n+++ fake header\n")
        const expected = yield* Effect.forEach(names, (name) =>
          Effect.all([
            commands.statUntracked(directory, name),
            commands.patchUntracked(directory, name, { context: 0 }),
          ]),
        )
        const before = yield* Effect.promise(() => fs.readFile(index))
        const objectNames = () => Effect.promise(() => fs.readdir(objects, { recursive: true }))
        const beforeObjects = (yield* objectNames()).toSorted()
        const vcs = yield* init()
        const previous = process.env.GIT_TRACE2_EVENT
        process.env.GIT_TRACE2_EVENT = trace.replaceAll("\\", "/")
        const diff = yield* vcs.diff("git", { context: 0 }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (previous === undefined) delete process.env.GIT_TRACE2_EVENT
              else process.env.GIT_TRACE2_EVENT = previous
            }),
          ),
        )
        expect(yield* Effect.promise(() => fs.readFile(index))).toEqual(before)
        expect((yield* objectNames()).toSorted()).toEqual(beforeObjects)
        expect(diff.some((item) => item.file === "ignored/skip.txt")).toBe(false)
        expect(diff.find((item) => item.file === "ignored/tracked.txt")?.status).toBe("deleted")
        for (const [position, name] of names.entries()) {
          const [stat, patch] = expected[position]!
          expect(diff.find((item) => item.file === name)).toEqual({
            file: name,
            status: "added",
            additions: stat?.additions ?? 0,
            deletions: stat?.deletions ?? 0,
            patch: patch.text,
          })
        }
        const events = yield* Effect.promise(() => fs.readFile(trace, "utf8"))
        expect(events.match(/"--no-index"/g) ?? []).toHaveLength(0)
      }),
    { git: true },
    20_000,
  )

  // FORK: cover a fresh linked Git worktree and scoped diff from a nested directory [feat: deskfox-vcs-refresh-overload]
  worktreeIt.live(
    "batches from a subdirectory without importing changes outside the scope",
    () =>
      Effect.gen(function* () {
        const root = yield* tmpdirScoped({ git: true })
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp, "linked")
        yield* git(root, ["worktree", "add", "--detach", directory, "HEAD"])
        const nested = path.join(directory, "sub")
        yield* write(path.join(directory, "outside.txt"), "outside\n")
        yield* write(path.join(nested, "one.txt"), "one\n")
        yield* write(path.join(nested, "two.txt"), "two\n")

        const diff = yield* Vcs.Service.use((vcs) => vcs.diff("git")).pipe(provideInstance(nested))
        expect(diff.map((item) => item.file)).toEqual(["sub/one.txt", "sub/two.txt"])
        expect(diff[0]).toMatchObject({ additions: 1, deletions: 0, status: "added" })
        expect(diff[0]?.patch).toContain("+++ b/sub/one.txt")
      }),
    20_000,
  )

  // FORK: an unborn branch can also contain staged and untracked paths [feat: deskfox-vcs-refresh-overload]
  it.instance(
    "batches untracked additions before the initial commit",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        yield* git(instance.directory, ["symbolic-ref", "HEAD", "refs/heads/unborn"])
        for (const name of ["one.txt", "two.txt", "staged.txt"]) {
          yield* write(path.join(instance.directory, name), "new contents\n")
        }
        yield* git(instance.directory, ["add", "staged.txt"])
        const vcs = yield* init()
        const diff = yield* vcs.diff("git")
        expect(diff.map((item) => item.file)).toEqual(["one.txt", "staged.txt", "two.txt"])
        for (const item of diff) {
          expect(item).toMatchObject({ additions: 1, deletions: 0, status: "added" })
          expect(item.patch).toContain("+new contents")
        }
      }),
    { git: true },
    20_000,
  )

  it.instance(
    "diff('git') handles special filenames",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, weird), "hello\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")

        expect(diff).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file: weird,
              status: "added",
            }),
          ]),
        )
      }),
    { git: true },
  )

  it.instance(
    "diff('git') keeps batched patches aligned for type changes",
    () =>
      Effect.gen(function* () {
        if (process.platform === "win32") return

        const test = yield* TestInstance
        yield* write(path.join(test.directory, "a.txt"), "old\n")
        yield* write(path.join(test.directory, "b.txt"), "old\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "add files"])
        yield* remove(path.join(test.directory, "a.txt"))
        yield* symlink("target", path.join(test.directory, "a.txt"))
        yield* write(path.join(test.directory, "b.txt"), "new\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")
        const a = diff.find((item) => item.file === "a.txt")
        const b = diff.find((item) => item.file === "b.txt")

        expect(a?.patch).toContain("deleted file mode")
        expect(a?.patch).toContain("new file mode")
        expect(b?.patch).toContain("+new")
      }),
    { git: true },
  )

  it.instance(
    "diff('git') keeps carriage returns inside patch hunks",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* write(path.join(test.directory, "file.txt"), "keep\nsame\rdiff --git inside\ndelete\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "add file"])
        yield* write(path.join(test.directory, "file.txt"), "keep\nadd\nsame\rdiff --git inside\n")

        const vcs = yield* init()
        const diff = yield* vcs.diff("git")
        const file = diff.find((item) => item.file === "file.txt")

        expect(file?.patch).toContain(" same\rdiff --git inside")
        expect(file?.patch).toContain("-delete")
        expect(() => parsePatch(file?.patch ?? "")).not.toThrow()
      }),
    { git: true },
    20_000,
  )

  it.instance(
    "diff('branch') returns changes against default branch",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        yield* git(test.directory, ["branch", "-M", "main"])
        yield* git(test.directory, ["checkout", "-b", "feature/test"])
        yield* write(path.join(test.directory, "branch.txt"), "hello\n")
        yield* git(test.directory, ["add", "."])
        yield* git(test.directory, ["commit", "--no-gpg-sign", "-m", "branch file"])

        const vcs = yield* init()
        const diff = yield* vcs.diff("branch")

        expect(diff).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              file: "branch.txt",
              status: "added",
            }),
          ]),
        )
      }),
    { git: true },
  )
})
