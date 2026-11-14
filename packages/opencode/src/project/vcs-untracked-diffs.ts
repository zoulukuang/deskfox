// FORK-ONLY: batch Git diffs for untracked paths without writing the project index [feat: deskfox-vcs-refresh-overload]
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Stream } from "effect"
import type { Git } from "@/git"

export const untrackedDiffs = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  items: Git.Item[],
  options: Git.PatchOptions,
) {
  const names = items.filter((item) => item.code === "??" && !item.file.endsWith("/")).map((item) => item.file)
  if (names.length < 2) return

  return yield* Effect.acquireUseRelease(
    Effect.tryPromise(() => mkdtemp(path.join(tmpdir(), "deskfox-vcs-index-"))),
    (directory) =>
      Effect.gen(function* () {
        const worktree = yield* git.run(["rev-parse", "--show-toplevel"], { cwd })
        if (worktree.exitCode !== 0) return
        const root = worktree.text().replace(/\r?\n$/, "")
        const env = { GIT_INDEX_FILE: path.join(directory, "index"), GIT_OBJECT_DIRECTORY: directory }
        // Git gets literal NUL-separated names, including long lists and names with newlines.
        const added = yield* git.run(
          [
            "-c",
            "core.hooksPath=" + path.join(directory, "hooks"),
            "--literal-pathspecs",
            "add",
            "--intent-to-add",
            "--force",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
          ],
          { cwd: root, env, stdin: Stream.make(new TextEncoder().encode(names.join("\0") + "\0")) },
        )
        if (added.exitCode !== 0) return

        const result = yield* git.run(
          [
            "diff",
            "--no-ext-diff",
            "--no-renames",
            "--numstat",
            "-z",
            "--patch",
            `--unified=${options.context ?? 3}`,
            "--",
            ".",
          ],
          { cwd: root, env, maxOutputBytes: options.maxOutputBytes },
        )
        if (result.exitCode !== 0) return
        const text = result.text()
        // Git emits ordered numstat records, a NUL separator, then patches in the same order.
        // Pair by position to preserve empty/binary patches and filenames containing " b/".
        const separator = text.indexOf("\0\0")
        if (separator < 0) return
        const patches = text.slice(separator + 2).split(/(?<=\n)(?=diff --git )/)
        if (result.truncated) patches.pop()
        const stats = text.slice(0, separator).split("\0")
        if (!result.truncated && patches.length !== stats.length) return
        return new Map(
          stats.flatMap((entry, index) => {
            const match = /^(\d+|-)\t(?:\d+|-)\t([\s\S]+)$/.exec(entry)
            if (!match?.[2]) return []
            return [[match[2], { additions: Number(match[1]) || 0, deletions: 0, patch: patches[index] }] as const]
          }),
        )
      }),
    (directory) => Effect.tryPromise(() => rm(directory, { recursive: true, force: true })).pipe(Effect.ignore),
  ).pipe(Effect.catch(() => Effect.succeed(undefined)))
})
