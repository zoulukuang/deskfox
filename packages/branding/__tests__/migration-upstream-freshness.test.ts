import { expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

test("failed upstream fetch cannot report cached migrations as a fresh clean check", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "deskfox-upstream-check-"))
  try {
    const migrations = "packages/core/src/database/migration"
    await mkdir(path.join(directory, migrations), { recursive: true })
    await mkdir(path.join(directory, "packages/branding/scripts"), { recursive: true })
    await writeFile(path.join(directory, migrations, "20260101000000_old.ts"), "")
    await cp(
      path.join(import.meta.dir, "../scripts/gen-migration-baseline.mjs"),
      path.join(directory, "packages/branding/scripts/gen-migration-baseline.mjs"),
    )
    for (const args of [
      ["init", "--quiet"],
      ["add", migrations],
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "--no-gpg-sign",
        "-m",
        "fixture",
      ],
      ["update-ref", "refs/remotes/upstream/dev", "HEAD"],
      ["remote", "add", "upstream", path.join(directory, "missing-remote")],
    ]) {
      const child = Bun.spawn(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
      const result = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(result[2], result[1]).toBe(0)
    }
    const child = Bun.spawn(["node", "packages/branding/scripts/gen-migration-baseline.mjs", "--check-upstream"], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    })
    const result = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(result[2], result[1]).toBe(0)
    expect(result[0]).toContain("未检查成功")
    expect(result[0]).toContain("缓存")
    expect(result[0]).not.toContain("✅ 上游未领先")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
