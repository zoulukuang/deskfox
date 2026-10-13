import { beforeAll, afterAll, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRepository } from "../../src/deskfox/repository"

const build = await realpath(await mkdtemp(path.join(tmpdir(), "deskfox-io-fault-build-")))
beforeAll(async () => {
  const result = await Bun.build({
    entrypoints: [path.join(import.meta.dir, "io-fault-worker.ts")],
    target: "node",
    outdir: build,
    naming: "worker.mjs",
  })
  expect(result.success).toBe(true)
})
afterAll(() => rm(build, { recursive: true, force: true }))

test.each(
  ["write", "file-sync", "rename", "directory-sync"].flatMap((boundary) =>
    ["error", "kill"].map((behavior) => ({ boundary, behavior })),
  ),
)(
  "cancellation survives $behavior at $boundary without partial or resurrected data",
  async ({ boundary, behavior }) => {
    const directory = await realpath(await mkdtemp(path.join(tmpdir(), "deskfox-io-fault-")))
    const options = { directory, maxBytes: 1024 * 1024, minimumFreeBytes: 0 }
    try {
      const repository = await createRepository(options)
      const share = await repository.create({ sessionID: "ses_fault" }, "a".repeat(64))
      await repository.sync({
        share,
        data: [
          {
            type: "session",
            data: {
              id: "ses_fault",
              title: "BEFORE_CANCEL",
              directory: "/test",
              slug: "fault",
              version: "1",
              projectID: "proj_test",
              time: { created: 1, updated: 1 },
            },
          },
        ],
      })
      const child = Bun.spawn(
        ["node", path.join(build, "worker.mjs"), directory, share.id, share.secret, boundary, behavior],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]).finally(() => clearTimeout(timer))
      expect(stderr).toBe("")
      if (behavior === "error") {
        expect(exit).toBe(0)
        expect(JSON.parse(stdout)).toEqual({ hit: true, outcome: `injected-${boundary}` })
        expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([])
      }
      if (behavior === "kill") {
        expect(child.signalCode).toBe("SIGKILL")
        expect(stdout).toBe(`fault:${boundary}\n`)
      }
      const envelope = JSON.parse(await readFile(path.join(directory, `${share.id}.json`), "utf8"))
      const committed = boundary === "directory-sync" || (boundary === "rename" && behavior === "kill")
      const restarted = await createRepository(options)
      expect(envelope.status).toBe(committed ? "deleted" : "ready")
      if (!committed) {
        expect(await restarted.get(share.id)).toBeDefined()
        expect(JSON.stringify(await restarted.data(share.id))).toContain("BEFORE_CANCEL")
        await restarted.remove(share)
      }
      expect(await restarted.get(share.id)).toBeUndefined()
      await expect(restarted.data(share.id)).rejects.toMatchObject({ code: "ShareNotFound" })
      await expect(restarted.sync({ share, data: [] })).rejects.toMatchObject({ code: "ShareNotFound" })
      await expect(restarted.create({ sessionID: "ses_fault" }, "a".repeat(64))).rejects.toMatchObject({
        code: "ShareConflict",
      })
      const tombstone = await readFile(path.join(directory, `${share.id}.json`), "utf8")
      expect(tombstone).not.toContain(share.secret)
      expect(tombstone).not.toContain("BEFORE_CANCEL")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
