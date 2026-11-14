import { describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, ManagedRuntime } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Git } from "../../src/git"
import { vcsRefreshRequired, VCS_REFRESH_LIMITS } from "../../src/project/vcs-refresh-required"

async function fixture(commit = true) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vcs-refresh-required-"))
  const env = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(directory, "global-config"),
    GIT_CONFIG_COUNT: "0",
  }
  await Bun.write(env.GIT_CONFIG_GLOBAL, "")
  const runtime = ManagedRuntime.make(LayerNode.compile(Git.node))
  const run = (args: string[]) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const git = yield* Git.Service
        const result = yield* git.run(args, { cwd: directory, env })
        expect(result.exitCode).toBe(0)
        return result.text()
      }),
    )
  await run(["init", "-q"])
  await run(["config", "user.name", "fixture"])
  await run(["config", "user.email", "fixture@example.invalid"])
  await run(["config", "commit.gpgsign", "false"])
  if (commit) await run(["commit", "--allow-empty", "-qm", "fixture"])
  return {
    directory,
    run,
    write: (file: string, content: string) => Bun.write(path.join(directory, file), content),
    check: (paths: string[], extra?: Record<string, string>) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const git = yield* Git.Service
          return yield* vcsRefreshRequired(
            { run: (args, options) => git.run(args, { ...options, env: { ...env, ...extra } }) },
            directory,
            paths,
          )
        }),
      ),
    async [Symbol.asyncDispose]() {
      await runtime.dispose()
      await fs.rm(directory, { recursive: true, force: true })
    },
  }
}

describe("Git-backed VCS refresh classification", () => {
  test("uses nested, global and info excludes but does not treat .ignore as Git rules", async () => {
    await using f = await fixture()
    await f.write(".gitignore", "*.log\n!keep.log\n")
    await f.write("nested/.gitignore", "*.cache\n!keep.cache\n")
    await f.write(".git/info/exclude", "*.info\n")
    await f.write("global-ignore", "*.global\n")
    await f.write(
      "global-config",
      `[core]\nexcludesfile = ${JSON.stringify(path.join(f.directory, "global-ignore"))}\n`,
    )
    await f.write(".ignore", "only-ignore.txt\n")
    expect(await f.check(["x.log", "nested/x.cache", "x.info", "x.global"])).toBe(false)
    expect(await f.check(["x.log", "keep.log"])).toBe(true)
    expect(await f.check(["nested/keep.cache"])).toBe(true)
    expect(await f.check(["only-ignore.txt"])).toBe(true)
    await f.write(".gitignore", "")
    expect(await f.check(["x.log"])).toBe(true)
  })

  test("keeps forced tracked files, tracked descendants and staged deletions", async () => {
    await using f = await fixture()
    await f.write(".gitignore", "ignored/\n*.log\n")
    await f.write("ignored/tracked.txt", "tracked")
    await f.write("tracked.log", "tracked")
    await f.run(["add", "-f", "ignored/tracked.txt", "tracked.log"])
    await f.run(["commit", "-qm", "tracked"])
    expect(await f.check(["tracked.log", "ignored/tracked.txt"])).toBe(true)
    expect(await f.check(["ignored"])).toBe(true)
    await fs.unlink(path.join(f.directory, "tracked.log"))
    expect(await f.check(["tracked.log"])).toBe(true)
    await f.run(["rm", "-q", "ignored/tracked.txt", "tracked.log"])
    expect(await f.check(["tracked.log"])).toBe(true)
    expect(await f.check(["ignored/tracked.txt"])).toBe(true)
    expect(await f.check(["ignored"])).toBe(true)
    expect(await f.check(["ignored/new.txt"])).toBe(false)
  })

  test("preserves literal filenames and absolute paths without decoding", async () => {
    await using f = await fixture()
    const names = [
      "space name.log",
      "中文.log",
      "%2F.log",
      "#.log",
      "-.log",
      ...(process.platform === "win32" ? [] : [":magic.log", "line\nname.log", "back\\slash.log"]),
    ]
    await f.write(".gitignore", "*.log\n-\n")
    expect(await f.check([...names, "-"])).toBe(false)
    expect(await f.check(names.map((name) => path.join(f.directory, name)))).toBe(false)
    expect(await f.check(["*.log"])).toBe(false)
    await f.write("tracked.log", "x")
    await f.run(["add", "-f", "tracked.log"])
    await f.run(["commit", "-qm", "tracked"])
    await f.run(["rm", "-q", "tracked.log"])
    // A literal glob filename must not accidentally match a different tracked file in HEAD.
    expect(await f.check(["*.log"])).toBe(false)
  })

  test("fails open for unsafe/oversized inputs and missing HEAD", async () => {
    await using f = await fixture(false)
    await f.write(".gitignore", "*\n")
    for (const paths of [
      [],
      [""],
      ["x\0y"],
      ["../outside"],
      ["."],
      [".git/HEAD"],
      [".gitignore"],
      ["nested/.gitignore"],
      ["x.log"],
      Array(129).fill("x"),
      ["x".repeat(4097)],
      Array(128).fill("x".repeat(600)),
    ]) {
      expect(await f.check(paths)).toBe(true)
    }
    expect(VCS_REFRESH_LIMITS.paths).toBe(128)
    await fs.rm(path.join(f.directory, ".git"), { recursive: true })
    expect(await f.check(["x"])).toBe(true)
  })

  test.skipIf(process.platform === "win32")(
    "times out a real Git process blocked on an excludes FIFO and terminates it",
    async () => {
      await using f = await fixture()
      const fifo = path.join(f.directory, "blocked-ignore")
      expect(await Bun.spawn(["mkfifo", fifo]).exited).toBe(0)
      await f.run(["config", "core.excludesfile", fifo])
      const trace = path.join(f.directory, "git-trace.jsonl")
      const started = performance.now()
      expect(await f.check(["a.log"], { GIT_TRACE2_EVENT: trace })).toBe(true)
      expect(performance.now() - started).toBeLessThan(3000)
      const events = (await Bun.file(trace).text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      const sid = events.find((event) => event.event === "start")?.sid as string
      expect(sid).toMatch(/-P[0-9a-f]+$/i)
      const pid = Number.parseInt(sid.slice(sid.lastIndexOf("-P") + 2), 16)
      expect(() => process.kill(pid, 0)).toThrow()
    },
    5000,
  )
})
