import { expect, test } from "bun:test"
import { watch } from "node:fs"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createFileStore } from "../../src/deskfox/file-store"

test("a killed atomic writer leaves either the previous or complete next document", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "deskfox-share-crash-")))
  const id = "a".repeat(48)
  const store = await createFileStore(directory, 0)
  await store.write(id, JSON.stringify({ text: "previous" }))
  const temporary = Promise.withResolvers<void>()
  const watcher = watch(directory, (_, name) => {
    if (name?.toString().endsWith(".tmp")) temporary.resolve()
  })
  const child = Bun.spawn([process.execPath, "test/deskfox/crash-writer.ts", directory], {
    stdout: "ignore",
    stderr: "pipe",
  })
  const timeout = setTimeout(() => temporary.reject(new Error("Writer did not create a temporary file")), 5000)
  try {
    await temporary.promise
    child.kill("SIGKILL")
    await child.exited
    const restarted = await createFileStore(directory, 0)
    const content = await restarted.read(id)
    expect(content).toBeDefined()
    const value = JSON.parse(content!) as { text: string }
    expect(value.text === "previous" || value.text === "x".repeat(32 * 1024 * 1024)).toBe(true)
    await restarted.write(id, JSON.stringify({ text: "recovered" }))
    expect(await restarted.read(id)).toBe(JSON.stringify({ text: "recovered" }))
  } finally {
    clearTimeout(timeout)
    watcher.close()
    child.kill()
    await child.exited
    await rm(directory, { recursive: true, force: true })
  }
})
