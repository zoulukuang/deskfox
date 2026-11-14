// Watcher paths are native filesystem paths, not encoded file URLs.
export function vcsEventKind(file: string, directory: string) {
  const windows = /^[A-Za-z]:/.test(directory) || /^(\\\\|\/\/)/.test(directory)
  const root = (windows ? directory.replace(/\\/g, "/").toLowerCase() : directory).replace(/\/+$/, "")
  const path = (windows ? file.replace(/\\/g, "/").toLowerCase() : file).replace(/^\.\//, "")
  const relative = path.startsWith(root + "/") ? path.slice(root.length + 1) : path
  // Detached HEAD moves do not emit a branch-name change, but do change the diff.
  if (relative === (windows ? ".git/head" : ".git/HEAD")) return "head"
  if (relative === ".git" || relative.startsWith(".git/")) return "ignore"
  return "file"
}

export function shouldIgnoreVcsMetadata(file: string, directory: string) {
  return vcsEventKind(file, directory) === "ignore"
}
