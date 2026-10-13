import { afterEach, expect, test } from "bun:test"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { backupShares, removeShare, restoreShares } from "../../src/deskfox/maintenance"
import { createRepository } from "../../src/deskfox/repository"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "deskfox-maintenance-")))
  directories.push(root)
  const directory = path.join(root, "data")
  const repository = await createRepository({ directory, maxBytes: 100_000, minimumFreeBytes: 0 })
  const share = await repository.create({ sessionID: "ses_test" })
  await repository.sync({
    share,
    data: [
      {
        type: "session",
        data: {
          id: "ses_test",
          title: "Backup fixture",
          directory: "/fixture",
          version: "1",
          slug: "test",
          projectID: "proj_test",
          time: { created: 1, updated: 1 },
        },
      },
    ],
  })
  return {
    root,
    directory,
    repository,
    share,
    backup: path.join(root, "backup"),
    destination: path.join(root, "restored"),
    origin: "https://deskfox.cn",
  }
}

test("same-region recovery overlays later cancellations so old backups cannot resurrect content", async () => {
  const f = await fixture()
  await backupShares(f.directory, f.backup, f.origin)
  await removeShare(f.directory, f.share.id)
  await restoreShares({ ...f, latest: f.directory })
  const restored = await createRepository({ directory: f.destination, maxBytes: 100_000, minimumFreeBytes: 0 })
  expect(await restored.get(f.share.id)).toBeUndefined()
  await expect(restored.sync({ share: f.share, data: [] })).rejects.toMatchObject({ code: "ShareNotFound" })
  await removeShare(f.directory, f.share.id)
})

test("intact active shares restore with their original identity and snapshot", async () => {
  const f = await fixture()
  await backupShares(f.directory, f.backup, f.origin)
  await restoreShares({ ...f, latest: f.directory })
  const restored = await createRepository({ directory: f.destination, maxBytes: 100_000, minimumFreeBytes: 0 })
  expect(await restored.data(f.share.id)).toEqual(await f.repository.data(f.share.id))
  await restored.remove(f.share)
})

test("cross-region, incomplete-ledger, tampered and reused backup destinations fail closed", async () => {
  const f = await fixture()
  await backupShares(f.directory, f.backup, f.origin)
  await expect(backupShares(f.directory, f.backup, f.origin)).rejects.toThrow()
  await expect(restoreShares({ ...f, latest: f.directory, origin: "https://deskfox.ai" })).rejects.toThrow(
    "Cross-region",
  )
  await expect(restoreShares({ ...f, latest: path.join(f.root, "missing") })).rejects.toThrow()
  await writeFile(path.join(f.backup, `${f.share.id}.json`), "{}")
  await expect(restoreShares({ ...f, latest: f.directory })).rejects.toThrow("integrity")
})
