// Watcher paths are native filesystem paths, not encoded file URLs.
export function isVcsMetadataPath(file: string, directory: string) {
  const windows = /^[A-Za-z]:/.test(directory) || /^(\\\\|\/\/)/.test(directory)
  const root = (windows ? directory.replace(/\\/g, "/").toLowerCase() : directory).replace(/\/+$/, "")
  const path = (windows ? file.replace(/\\/g, "/").toLowerCase() : file).replace(/^\.\//, "")
  const relative = path.startsWith(root + "/") ? path.slice(root.length + 1) : path
  return relative === ".git" || relative.startsWith(".git/")
}
