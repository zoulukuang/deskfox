import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRepository } from "../../src/deskfox/repository"
import { createFileStore } from "../../src/deskfox/file-store"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture(maxBytes = 64 * 1024 * 1024) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "deskfox-share-test-")))
  directories.push(directory)
  const options = { directory, maxBytes, minimumFreeBytes: 0 }
  return { directory, options, repository: await createRepository(options) }
}

const session = {
  type: "session",
  data: {
    id: "ses_test",
    title: "Share test",
    directory: "/test",
    slug: "test",
    version: "1.0",
    projectID: "proj_test",
    time: { created: 1, updated: 1 },
  },
}
const message = {
  type: "message",
  data: {
    id: "msg_test",
    sessionID: "ses_test",
    role: "user",
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    time: { created: 1 },
  },
}
const part = (id: string) => ({
  type: "part",
  data: { id, sessionID: "ses_test", messageID: "msg_test", type: "text", text: id },
})

describe("isolated DeskFox share repository", () => {
  test("failed replacement and orphan temporary files never expose a partial snapshot", async () => {
    const { repository, directory } = await fixture()
    const share = await repository.create({ sessionID: "ses_test" })
    await repository.sync({ share, data: [session, message] })
    const original = await readFile(path.join(directory, `${share.id}.json`), "utf8")
    await writeFile(path.join(directory, `.${share.id}.interrupted.tmp`), '{"version":')
    await chmod(directory, 0o500)
    try {
      await expect(repository.sync({ share, data: [part("part_failed")] })).rejects.toThrow()
      expect(await readFile(path.join(directory, `${share.id}.json`), "utf8")).toBe(original)
      expect(await repository.data(share.id)).toHaveLength(2)
    } finally {
      await chmod(directory, 0o700)
    }
    const store = await createFileStore(directory, 0)
    const blocked = "f".repeat(48)
    await mkdir(path.join(directory, `${blocked}.json`))
    await expect(store.write(blocked, "{}")).rejects.toThrow()
    expect((await readdir(directory)).filter((name) => name.startsWith(`.${blocked}.`))).toEqual([])
  })

  test("corrupt envelopes fail closed instead of serving a previous cached snapshot", async () => {
    const { repository, directory } = await fixture()
    const share = await repository.create({ sessionID: "ses_test" })
    await repository.sync({ share, data: [session] })
    expect(await repository.get(share.id)).toBeDefined()
    await writeFile(path.join(directory, `${share.id}.json`), '{"version":')
    await expect(repository.get(share.id)).rejects.toThrow()
    await expect(repository.data(share.id)).rejects.toThrow()
  })

  test("keeps a new share private until an initial snapshot is valid", async () => {
    const { repository } = await fixture()
    const share = await repository.create({ sessionID: "ses_test" })
    expect(await repository.get(share.id)).toBeUndefined()
    await expect(repository.data(share.id)).rejects.toMatchObject({ code: "ShareNotFound" })
    await expect(repository.sync({ share, data: [part("part_test")] })).rejects.toMatchObject({ code: "ShareInvalid" })
    await repository.sync({ share, data: [session, message, part("part_test")] })
    expect(await repository.get(share.id)).toEqual({ id: share.id, sessionID: "ses_test" })
    expect(JSON.stringify(await repository.data(share.id))).not.toContain(share.secret)
  })

  test("recovers an identical create across repository restart but rejects a conflicting key", async () => {
    const { repository, options } = await fixture()
    const key = "a".repeat(64)
    const share = await repository.create({ sessionID: "ses_test" }, key)
    const restarted = await createRepository(options)
    expect(await restarted.create({ sessionID: "ses_test" }, key)).toEqual(share)
    await expect(restarted.create({ sessionID: "ses_other" }, key)).rejects.toMatchObject({ code: "ShareConflict" })
    await expect(restarted.create({ sessionID: "ses_test" }, "short")).rejects.toThrow()
  })

  test("concurrent create and incremental sync preserve every record", async () => {
    const { repository, options } = await fixture()
    const second = await createRepository(options)
    const shares = await Promise.all(
      Array.from({ length: 12 }, () => repository.create({ sessionID: "ses_test" }, "b".repeat(64))),
    )
    expect(new Set(shares.map((share) => share.secret)).size).toBe(1)
    const share = shares[0]
    await repository.sync({ share, data: [session, message] })
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        (index % 2 ? second : repository).sync({ share, data: [part(`part_${index}`)] }),
      ),
    )
    expect(await repository.data(share.id)).toHaveLength(22)
  })

  test("cancel tombstone erases body and secret and never revives through retry or queued sync", async () => {
    const { repository, directory, options } = await fixture()
    const key = "c".repeat(64)
    const share = await repository.create({ sessionID: "ses_test" }, key)
    await repository.sync({ share, data: [session, message] })
    const removing = repository.remove(share)
    const late = repository.sync({ share, data: [part("part_late")] })
    await removing
    await expect(late).rejects.toMatchObject({ code: "ShareNotFound" })
    const restarted = await createRepository(options)
    expect(await restarted.get(share.id)).toBeUndefined()
    await expect(restarted.data(share.id)).rejects.toMatchObject({ code: "ShareNotFound" })
    await expect(restarted.create({ sessionID: "ses_test" }, key)).rejects.toMatchObject({ code: "ShareConflict" })
    const tombstone = await readFile(path.join(directory, `${share.id}.json`), "utf8")
    expect(tombstone).not.toContain(share.secret)
    expect(tombstone).not.toContain("Share test")
    expect(tombstone).not.toContain("ses_test")
  })

  test("rejects invalid ownership, missing messages and malformed critical fields atomically", async () => {
    const { repository } = await fixture()
    const share = await repository.create({ sessionID: "ses_test" })
    await repository.sync({ share, data: [session, message] })
    for (const data of [
      [{ ...session, data: { ...session.data, id: "ses_other" } }],
      [{ ...message, data: { ...message.data, sessionID: "ses_other" } }],
      [{ ...part("part_a"), data: { ...part("part_a").data, messageID: "msg_missing" } }],
      [{ ...part("part_a"), data: { ...part("part_a").data, text: 123 } }],
      [{ type: "session", data: null }],
    ])
      await expect(repository.sync({ share, data })).rejects.toThrow()
    expect(await repository.data(share.id)).toHaveLength(2)
  })

  test("rejects incorrect credentials and cumulative limit without altering the snapshot", async () => {
    const { repository } = await fixture(1800)
    const share = await repository.create({ sessionID: "ses_test" })
    await repository.sync({ share, data: [session, message] })
    await expect(repository.remove({ ...share, secret: "wrong" })).rejects.toMatchObject({ code: "ShareForbidden" })
    await expect(repository.sync({ share: { ...share, secret: "wrong" }, data: [] })).rejects.toMatchObject({
      code: "ShareForbidden",
    })
    await expect(
      repository.sync({ share, data: [{ ...session, data: { ...session.data, title: "x".repeat(1500) } }] }),
    ).rejects.toMatchObject({ code: "ShareTooLarge" })
    expect(await repository.data(share.id)).toHaveLength(2)
  })

  test("rejects traversal, encoded separators, absolute paths and symlink files", async () => {
    const { repository, directory } = await fixture()
    for (const id of ["../secret", "/tmp/secret", "%2e%2e", "a/b", "a\\b", "a".repeat(49)])
      expect(() => repository.get(id)).toThrow()
    const other = await fixture()
    const id = "d".repeat(48)
    const store = await createFileStore(other.directory, 0)
    await store.write(id, "private")
    await symlink(path.join(other.directory, `${id}.json`), path.join(directory, `${id}.json`))
    await expect(repository.get(id)).rejects.toThrow()
    const link = path.join(directory, "link")
    await symlink(other.directory, link)
    await expect(createFileStore(link, 0)).rejects.toThrow("Symlink")
  })

  test("fails closed when storage reserve cannot admit a write", async () => {
    const { options } = await fixture()
    const repository = await createRepository({ ...options, minimumFreeBytes: Number.MAX_SAFE_INTEGER })
    await expect(repository.create({ sessionID: "ses_test" })).rejects.toThrow("storage full")
  })

  test("failed cancellation keeps the complete share and can be retried after storage recovers", async () => {
    const { repository, directory, options } = await fixture()
    const share = await repository.create({ sessionID: "ses_test" })
    await repository.sync({ share, data: [session, message, part("part_original")] })
    const original = await readFile(path.join(directory, `${share.id}.json`), "utf8")
    const full = await createRepository({ ...options, minimumFreeBytes: Number.MAX_SAFE_INTEGER })
    await expect(full.remove(share)).rejects.toThrow("storage full")
    expect(await readFile(path.join(directory, `${share.id}.json`), "utf8")).toBe(original)
    await chmod(directory, 0o500)
    try {
      await expect(repository.remove(share)).rejects.toThrow()
      expect(await readFile(path.join(directory, `${share.id}.json`), "utf8")).toBe(original)
      expect(await repository.data(share.id)).toHaveLength(3)
    } finally {
      await chmod(directory, 0o700)
    }
    const restarted = await createRepository(options)
    await restarted.remove(share)
    expect(await restarted.get(share.id)).toBeUndefined()
    await expect(restarted.data(share.id)).rejects.toMatchObject({ code: "ShareNotFound" })
    await expect(repository.sync({ share, data: [part("part_late")] })).rejects.toMatchObject({
      code: "ShareNotFound",
    })
    const tombstone = await readFile(path.join(directory, `${share.id}.json`), "utf8")
    expect(tombstone).not.toContain(share.secret)
    expect(tombstone).not.toContain("part_original")
  })

  test("does not persist or publish model connection secrets", async () => {
    const { repository, directory } = await fixture()
    const share = await repository.create({ sessionID: "ses_test" })
    await repository.sync({
      share,
      data: [
        session,
        {
          type: "model",
          data: [
            {
              id: "provider/model",
              providerID: "test",
              name: "Model",
              api: { id: "test", npm: "test", url: "https://model.example/?token=MODEL_SECRET" },
              headers: { Authorization: "MODEL_SECRET" },
              options: { apiKey: "MODEL_SECRET" },
              other: "MODEL_SECRET",
              status: "active",
              release_date: "2026-01-01",
              cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
              limit: { context: 1000, output: 100 },
              capabilities: {},
            },
          ],
        },
      ],
    })
    expect(JSON.stringify(await repository.data(share.id))).not.toContain("MODEL_SECRET")
    expect(await readFile(path.join(directory, `${share.id}.json`), "utf8")).not.toContain("MODEL_SECRET")
  })
})
