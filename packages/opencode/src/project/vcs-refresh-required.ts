import path from "path"
import { Effect, Stream } from "effect"
import type { Git } from "../git"

export const VCS_REFRESH_LIMITS = { paths: 128, pathBytes: 4096, bytes: 65536, timeout: 1000 } as const

export function validVcsRefreshPaths(paths: readonly string[]) {
  return (
    paths.length > 0 &&
    paths.length <= VCS_REFRESH_LIMITS.paths &&
    paths.every(
      (file) => file.length > 0 && !file.includes("\0") && Buffer.byteLength(file) <= VCS_REFRESH_LIMITS.pathBytes,
    ) &&
    paths.reduce((total, file) => total + Buffer.byteLength(file), 0) <= VCS_REFRESH_LIMITS.bytes
  )
}

// Only a successful, complete Git answer can suppress a refresh. In particular,
// the index alone cannot protect files just removed by `git rm`: consult HEAD too.
export function vcsRefreshRequired(git: Pick<Git.Interface, "run">, directory: string, paths: readonly string[]) {
  return Effect.gen(function* () {
    if (!path.isAbsolute(directory) || !validVcsRefreshPaths(paths)) return true
    const relative = [...new Set(paths.map((file) => path.relative(directory, path.resolve(directory, file))))]
    if (relative.some((file) => !file || path.isAbsolute(file) || file === ".." || file.startsWith(".." + path.sep)))
      return true
    // Native paths are not URLs; preserve percent signs, newlines and POSIX backslashes.
    const files = relative.map((file) => "./" + (path.sep === "\\" ? file.replaceAll("\\", "/") : file))
    if (files.some((file) => file === "./.gitignore" || file.endsWith("/.gitignore") || file.startsWith("./.git/")))
      return true
    const ignored = yield* git.run(["check-ignore", "--stdin", "-z"], {
      cwd: directory,
      maxOutputBytes: 131072,
      stdin: Stream.make(new TextEncoder().encode(files.join("\0") + "\0")),
    })
    if (ignored.exitCode !== 0 || ignored.truncated || ignored.stderr.length > 0) return true
    const output = ignored.text()
    if (!output.endsWith("\0")) return true
    const matches = new Set(output.slice(0, -1).split("\0"))
    if (matches.size !== files.length || files.some((file) => !matches.has(file))) return true
    const head = yield* git.run(["--literal-pathspecs", "ls-tree", "-z", "--name-only", "HEAD", "--", ...files], {
      cwd: directory,
      maxOutputBytes: 131072,
    })
    return head.exitCode !== 0 || head.truncated || head.stderr.length > 0 || head.stdout.length > 0
  }).pipe(
    Effect.timeout(VCS_REFRESH_LIMITS.timeout),
    Effect.catchCause(() => Effect.succeed(true)),
  )
}
