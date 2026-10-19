import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pruneBackups } from "../../src/deskfox/maintenance"

const directories: string[] = []
const now = Date.UTC(2026, 9, 19)
const day = 24 * 60 * 60 * 1000
const origin = "https://deskfox.cn"

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "deskfox-retention-")))
  directories.push(directory)
  return directory
}

async function archive(directory: string, name: string, created: number, region = origin) {
  const backup = path.join(directory, name)
  await mkdir(backup)
  await writeFile(
    path.join(backup, "manifest.json"),
    JSON.stringify({ version: 1, origin: region, created, files: [] }),
  )
  await writeFile(path.join(backup, "private.json"), "synthetic backup body")
  return backup
}

test("seven-day cutoff removes only expired archives, preserving recent and unrelated data", async () => {
  const root = await fixture()
  const old = await archive(root, "20261012T000000Z-1234abcd", now - 7 * day)
  const recent = await archive(root, "20261013T000000Z-5678abcd", now - 7 * day + 1)
  const unrelated = await archive(root, "manual-recovery", now - 30 * day)
  expect(await pruneBackups(root, origin, now)).toEqual({ removed: 1 })
  await expect(readFile(path.join(old, "private.json"))).rejects.toMatchObject({ code: "ENOENT" })
  expect(await readFile(path.join(recent, "private.json"), "utf8")).toBe("synthetic backup body")
  expect(await readFile(path.join(unrelated, "private.json"), "utf8")).toBe("synthetic backup body")
})

test("cross-region or incomplete archives prevent all pruning", async () => {
  const root = await fixture()
  const old = await archive(root, "20261001T000000Z-1234abcd", now - 20 * day)
  const foreign = await archive(root, "20261002T000000Z-5678abcd", now - 20 * day, "https://deskfox.ai")
  await expect(pruneBackups(root, origin, now)).rejects.toThrow("Cross-region")
  expect(await readFile(path.join(old, "private.json"), "utf8")).toBe("synthetic backup body")
  await rm(path.join(foreign, "manifest.json"))
  await expect(pruneBackups(root, origin, now)).rejects.toThrow()
  expect(await readFile(path.join(old, "private.json"), "utf8")).toBe("synthetic backup body")
})

test("a symlink backup root cannot prune its target", async () => {
  const root = await fixture()
  const target = await fixture()
  const old = await archive(target, "20261001T000000Z-1234abcd", now - 20 * day)
  await symlink(target, path.join(root, "linked"), "junction")
  await expect(pruneBackups(path.join(root, "linked"), origin, now)).rejects.toThrow("Symlink")
  expect(await readFile(path.join(old, "private.json"), "utf8")).toBe("synthetic backup body")
})
