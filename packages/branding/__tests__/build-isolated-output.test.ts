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

for (const output of ["", "dist-deskfox", "./dist-deskfox/../dist-deskfox", "alias", ".", "candidate with spaces"]) {
  test.skipIf(process.platform === "win32")(`macOS isolated output: ${output || "default"}`, async () => {
    const source = await readFile(path.join(import.meta.dir, "../scripts/build-deskfox-electron.sh"), "utf8")
    const start = source.indexOf("# FORK-BEGIN: isolated candidate output")
    expect(start).toBeGreaterThan(-1)
    const block = source.slice(start, source.indexOf("# FORK-END", start))
    const directory = await mkdtemp(path.join(tmpdir(), "deskfox-mac-output-"))
    try {
      const { mkdir, realpath, symlink } = await import("node:fs/promises")
      await mkdir(path.join(directory, "dist-deskfox"))
      await symlink(path.join(directory, "dist-deskfox"), path.join(directory, "alias"))
      const runner = path.join(directory, "check.sh")
      await writeFile(
        runner,
        [
          "set -euo pipefail",
          'DESKTOP="$1"',
          "KEEP_RUNNING=1",
          'OUTPUT_DIRECTORY="$2"',
          block,
          'printf "%s" "$OUT"',
        ].join("\n"),
      )
      const child = Bun.spawn(["bash", runner, directory, output], { stdout: "pipe", stderr: "pipe" })
      const result = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      if (output === "candidate with spaces") {
        expect(result[2]).toBe(0)
        expect(result[0]).toBe(path.join(await realpath(directory), output))
        return
      }
      expect(result[2]).not.toBe(0)
      expect(result[1]).toContain("keep-running requires")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test.skipIf(process.platform !== "darwin")(
  "clean macOS build generates its icon without a Tauri checkout",
  async () => {
    const scriptDir = path.join(import.meta.dir, "../scripts")
    const source = await readFile(path.join(scriptDir, "build-deskfox-electron.sh"), "utf8")
    const block = source.slice(source.indexOf("# === 2."), source.indexOf("# === 3."))
    const directory = await mkdtemp(path.join(tmpdir(), "deskfox-mac-icon-"))
    try {
      const { cp, mkdir, stat } = await import("node:fs/promises")
      const assets = path.join(directory, "src/assets/icons/prod")
      await mkdir(assets, { recursive: true })
      await cp(path.join(import.meta.dir, "../src/assets/icons/prod/ico-source"), path.join(assets, "ico-source"), {
        recursive: true,
      })
      const runner = path.join(directory, "check.sh")
      await writeFile(
        runner,
        ["set -euo pipefail", "ENV=prod", 'BRANDING_ROOT="$1"', 'SCRIPT_DIR="$2"', block].join("\n"),
      )
      const child = Bun.spawn(["bash", runner, directory, scriptDir], { stdout: "pipe", stderr: "pipe" })
      const result = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(result[2]).toBe(0)
      expect(result[1]).not.toContain("src-tauri")
      expect((await stat(path.join(assets, "icon.icns"))).size).toBeGreaterThan(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
