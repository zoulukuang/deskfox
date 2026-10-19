import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

test.skipIf(process.platform !== "win32")(
  "candidate output rejects aliases of the default directory while applications keep running",
  async () => {
    const source = await readFile(path.join(import.meta.dir, "../scripts/build-deskfox-electron.ps1"), "utf8")
    const start = source.indexOf("# FORK-BEGIN: isolated candidate output")
    expect(start).toBeGreaterThan(-1)
    const block = source.slice(start, source.indexOf("# FORK-END", start))
    const directory = await mkdtemp(path.join(tmpdir(), "deskfox-isolated-output-"))
    try {
      for (const output of ["", "dist-deskfox", "./dist-deskfox/../dist-deskfox", "candidate"]) {
        const runner = path.join(directory, "check.ps1")
        await writeFile(
          runner,
          "\uFEFF" +
            [
              "$ErrorActionPreference = 'Stop'",
              `$desktop = '${directory.replaceAll("'", "''")}'`,
              "$KeepRunning = $true",
              `$OutputDirectory = '${output}'`,
              block,
              "Write-Output $out",
            ].join("\r\n"),
        )
        const child = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-File", runner], {
          stdout: "pipe",
          stderr: "pipe",
        })
        const result = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        if (output === "candidate") {
          expect(result[2]).toBe(0)
          expect(result[0].trim()).toBe(path.join(directory, "candidate"))
          continue
        }
        expect(result[2]).not.toBe(0)
        expect(result[1]).toContain("KeepRunning requires")
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
