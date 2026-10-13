import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import z from "zod"
import { createFileStore } from "./file-store"
import { createRepository, envelopeSchema } from "./repository"
import { shareIDSchema } from "./schema"

const manifestSchema = z.object({
  version: z.literal(1),
  origin: z.enum(["https://deskfox.cn", "https://deskfox.ai"]),
  created: z.number(),
  files: z.array(z.object({ id: shareIDSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) })),
})

// All maintenance runs offline while holding the same supervisor flock as the service.
// A backup contains deletion credentials and must stay in a private, same-region directory.
export async function backupShares(directory: string, destination: string, origin: string) {
  const store = await createFileStore(directory, 0)
  const records = await Promise.all(
    (await ids(directory)).map(async (id) => {
      const text = await store.read(id)
      if (!text || envelopeSchema.parse(JSON.parse(text)).id !== id) throw new Error("Invalid backup source")
      return { id, text, sha256: hash(text) }
    }),
  )
  const manifest = manifestSchema.parse({
    version: 1,
    origin,
    created: Date.now(),
    files: records.map(({ id, sha256 }) => ({ id, sha256 })),
  })
  await mkdir(destination, { mode: 0o700 }) // Never overwrite an earlier backup.
  const output = await createFileStore(destination, 0)
  for (const item of records) await output.write(item.id, item.text)
  // Written last: an interrupted copy without its manifest is not a restorable backup.
  await writeFile(path.join(destination, "manifest.json"), JSON.stringify(manifest), {
    mode: 0o600,
    flag: "wx",
    flush: true,
  })
  return { records: records.length }
}

export async function restoreShares(input: { backup: string; latest: string; destination: string; origin: string }) {
  if ((await realpath(input.backup)) !== path.resolve(input.backup)) throw new Error("Symlink backup rejected")
  if ((await realpath(input.latest)) !== path.resolve(input.latest))
    throw new Error("Missing or symlink deletion ledger")
  if (
    (await realpath(path.join(input.backup, "manifest.json"))) !==
    path.join(path.resolve(input.backup), "manifest.json")
  )
    throw new Error("Symlink manifest rejected")
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(input.backup, "manifest.json"), "utf8")))
  if (manifest.origin !== input.origin) throw new Error("Cross-region restore rejected")
  const backup = await createFileStore(input.backup, 0)
  const latest = await createFileStore(input.latest, 0)
  const ledger = await ids(input.latest)
  if (manifest.files.some((item) => !ledger.includes(item.id)))
    throw new Error("Incomplete latest deletion ledger; public restore forbidden")
  const records = new Map<string, string>()
  for (const item of manifest.files) {
    const text = await backup.read(item.id)
    if (!text || hash(text) !== item.sha256 || envelopeSchema.parse(JSON.parse(text)).id !== item.id)
      throw new Error("Backup integrity failure")
    records.set(item.id, text)
  }
  // Overlay the latest tombstones before writing any restored body. Restoring only an old
  // backup is forbidden: it could resurrect a share that was subsequently cancelled.
  for (const id of ledger) {
    const text = await latest.read(id)
    if (!text) throw new Error("Deletion ledger changed during restore")
    const value = envelopeSchema.parse(JSON.parse(text))
    if (value.id !== id) throw new Error("Invalid deletion ledger")
    if (value.status === "deleted") records.set(id, text)
  }
  await mkdir(input.destination, { mode: 0o700 }) // Restore into an unused staging directory.
  const output = await createFileStore(input.destination, 0)
  for (const [id, text] of records) await output.write(id, text)
  return { records: records.size }
}

export async function removeShare(directory: string, id: string) {
  shareIDSchema.parse(id)
  const store = await createFileStore(directory, 0)
  const text = await store.read(id)
  if (!text) return
  const value = envelopeSchema.parse(JSON.parse(text))
  if (value.id !== id) throw new Error("Invalid share envelope")
  if (value.status === "deleted") return
  if (!value.info) throw new Error("Missing removal credentials")
  const repository = await createRepository({ directory, maxBytes: Number.MAX_SAFE_INTEGER, minimumFreeBytes: 0 })
  await repository.remove(value.info)
}

async function ids(directory: string) {
  return (await readdir(directory)).filter((name) => /^[a-f0-9]{48}\.json$/.test(name)).map((name) => name.slice(0, -5))
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
