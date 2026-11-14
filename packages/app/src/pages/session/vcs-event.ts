// Watcher paths are native filesystem paths, not encoded file URLs.
export function shouldIgnoreVcsMetadata(file: string, directory: string) {
  const windows = /^[A-Za-z]:/.test(directory) || /^(\\\\|\/\/)/.test(directory)
  const root = (windows ? directory.replace(/\\/g, "/").toLowerCase() : directory).replace(/\/+$/, "")
  const path = (windows ? file.replace(/\\/g, "/").toLowerCase() : file).replace(/^\.\//, "")
  const relative = path.startsWith(root + "/") ? path.slice(root.length + 1) : path
  // Detached HEAD moves do not emit a branch-name change, but do change the diff.
  if (relative === (windows ? ".git/head" : ".git/HEAD")) return false
  return relative === ".git" || relative.startsWith(".git/")
}
