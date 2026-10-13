import { constants } from "node:fs"
import { mkdir, open, realpath, rename, statfs, unlink } from "node:fs/promises"
import path from "node:path"
import { randomBytes } from "node:crypto"

// Flat opaque names eliminate user-controlled directory traversal. Data directories must be
// service-owned; production supervisor holds an exclusive flock for the process lifetime.
export async function createFileStore(directory: string, minimumFreeBytes: number) {
  if (!path.isAbsolute(directory)) throw new Error("Share directory must be absolute")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if ((await realpath(directory)) !== path.resolve(directory)) throw new Error("Symlink share directory rejected")
  const filename = (id: string) => {
    if (!/^[a-f0-9]{48}$/.test(id)) throw new Error("Invalid storage key")
    return path.join(directory, `${id}.json`)
  }
  return {
    async read(id: string) {
      const handle = await open(filename(id), constants.O_RDONLY | constants.O_NOFOLLOW).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined
          throw error
        },
      )
      if (!handle) return
      return handle.readFile("utf8").finally(() => handle.close())
    },
    async write(id: string, content: string) {
      const destination = filename(id)
      const capacity = await statfs(directory)
      if (capacity.bavail * capacity.bsize < minimumFreeBytes + Buffer.byteLength(content))
        throw new Error("Share storage full")
      const temporary = path.join(directory, `.${id}.${randomBytes(12).toString("hex")}.tmp`)
      const handle = await open(temporary, "wx", 0o600)
      await handle
        .writeFile(content)
        .then(() => handle.sync())
        .finally(() => handle.close())
        .then(() => rename(temporary, destination))
        .catch(async (error: unknown) => {
          await unlink(temporary).catch(() => undefined)
          throw error
        })
      const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY)
      await parent.sync().finally(() => parent.close())
    },
  }
}
