import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const directory = await realpath(await mkdtemp(path.join(tmpdir(), "deskfox-share-browser-")))
const child = Bun.spawn(["node", ".output/server/index.mjs"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: process.env.SHARE_BROWSER_PORT ?? "4410",
    OPENCODE_STORAGE_ADAPTER: "filesystem",
    DESKFOX_SHARE_DIRECTORY: directory,
    DESKFOX_SHARE_PUBLIC_ORIGIN: "https://deskfox.ai",
    DESKFOX_SHARE_MIN_FREE_BYTES: "1",
  },
  stdout: "inherit",
  stderr: "inherit",
})
process.on("SIGTERM", () => child.kill())
process.on("SIGINT", () => child.kill())
await child.exited
await rm(directory, { recursive: true, force: true })
process.exit(child.exitCode ?? 1)
