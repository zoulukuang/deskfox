import { expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { devNull, tmpdir } from "node:os"
import path from "node:path"

const name = "failed upstream fetch cannot report cached migrations as a fresh clean check"
// Git hooks export repository context; cwd alone does not isolate a fixture repository.
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
}

test(name, async () => {
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
      const child = Bun.spawn(["git", ...args], { cwd: directory, env, stdout: "pipe", stderr: "pipe" })
      const result = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(result[2], result[1]).toBe(0)
    }
    const child = Bun.spawn(["node", "packages/branding/scripts/gen-migration-baseline.mjs", "--check-upstream"], {
      cwd: directory,
      env,
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

test("upstream freshness fixture preserves an inherited push repository", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "deskfox-push-context-"))
  try {
    await writeFile(path.join(directory, "keep.txt"), "keep parent worktree\n")
    for (const args of [
      ["init", "--quiet"],
      ["add", "keep.txt"],
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "--no-gpg-sign",
        "-m",
        "parent",
      ],
    ]) {
      const child = Bun.spawn(["git", ...args], { cwd: directory, env, stdout: "pipe", stderr: "pipe" })
      const result = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(result[2], result[1]).toBe(0)
    }
    const metadata = await Promise.all(
      ["HEAD", "config", "index"].map((file) => Bun.file(path.join(directory, ".git", file)).bytes()),
    )
    const child = Bun.spawn([process.execPath, "test", import.meta.path, "--test-name-pattern", `^${name}$`], {
      cwd: path.join(import.meta.dir, ".."),
      env: {
        ...env,
        GIT_DIR: path.join(directory, ".git"),
        GIT_COMMON_DIR: path.join(directory, ".git"),
        GIT_INDEX_FILE: path.join(directory, ".git/index"),
        GIT_IMPLICIT_WORK_TREE: "0",
        GIT_PREFIX: "packages/branding/",
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const result = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(result[2], result[0] + result[1]).toBe(0)
    expect(
      await Promise.all(["HEAD", "config", "index"].map((file) => Bun.file(path.join(directory, ".git", file)).bytes())),
    ).toEqual(metadata)
    expect(await Bun.file(path.join(directory, "keep.txt")).text()).toBe("keep parent worktree\n")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
