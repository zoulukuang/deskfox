// FORK-ONLY: REQ-069 锚契约测试 2026-07-04
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { exec } from "child_process"
import { promisify } from "util"
import { Effect } from "effect"
import {
  ANCHOR_DIR,
  ANCHOR_FILE,
  mintId,
  readAnchor,
  writeAnchor,
  appendToInfoExclude,
  hideAnchorDir,
} from "@opencode-ai/core/project/anchor"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { tmpdir } from "./fixture/tmpdir"
import { it } from "./lib/effect"

const execAsync = promisify(exec)

// 用真实文件系统(FSUtil.defaultLayer)跑 IO 测试
const fsLayer = FSUtil.defaultLayer

// 辅助:在 Effect 中创建/销毁临时目录,并 provide fsLayer
function withTmpdir<A, E>(body: (dir: string) => Effect.Effect<A, E, FSUtil.Service>) {
  return Effect.acquireUseRelease(
    Effect.promise(() => tmpdir()),
    (tmp) => body(tmp.path),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  ).pipe(Effect.provide(fsLayer))
}

// ─── 磁盘契约常量 ─────────────────────────────────────────────────────────────

describe("anchor constants", () => {
  it.effect("ANCHOR_DIR and ANCHOR_FILE are stable strings", () =>
    Effect.sync(() => {
      expect(ANCHOR_DIR).toBe(".deskfox")
      expect(ANCHOR_FILE).toBe("id")
    }),
  )
})

// ─── mintId ──────────────────────────────────────────────────────────────────

describe("mintId", () => {
  it.effect("returns an ID with fld_ prefix", () =>
    Effect.sync(() => {
      const id = mintId()
      expect(id).toStartWith("fld_")
    }),
  )

  it.effect("returns unique IDs on each call", () =>
    Effect.sync(() => {
      const ids = new Set(Array.from({ length: 20 }, () => mintId()))
      expect(ids.size).toBe(20)
    }),
  )

  it.effect("has consistent format: fld_ + 32 hex chars", () =>
    Effect.sync(() => {
      const id = mintId()
      expect(id).toMatch(/^fld_[0-9a-f]{32}$/)
    }),
  )
})

// ─── readAnchor 四态 ──────────────────────────────────────────────────────────

describe("readAnchor", () => {
  it.live("returns undefined when anchor file does not exist (no anchor directory)", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const result = yield* readAnchor(dir)
        expect(result).toBeUndefined()
      }),
    ),
  )

  it.live("returns undefined when anchor directory exists but file is missing", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => fs.mkdir(path.join(dir, ANCHOR_DIR), { recursive: true }))
        const result = yield* readAnchor(dir)
        expect(result).toBeUndefined()
      }),
    ),
  )

  it.live("returns undefined when anchor file exists but is empty", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const anchorDir = path.join(dir, ANCHOR_DIR)
        yield* Effect.promise(() => fs.mkdir(anchorDir, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(anchorDir, ANCHOR_FILE), ""))
        const result = yield* readAnchor(dir)
        expect(result).toBeUndefined()
      }),
    ),
  )

  it.live("returns undefined when anchor file contains only whitespace", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const anchorDir = path.join(dir, ANCHOR_DIR)
        yield* Effect.promise(() => fs.mkdir(anchorDir, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(anchorDir, ANCHOR_FILE), "   \n  "))
        const result = yield* readAnchor(dir)
        expect(result).toBeUndefined()
      }),
    ),
  )

  it.live("returns ID when anchor file contains valid id", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const id = mintId()
        const anchorDir = path.join(dir, ANCHOR_DIR)
        yield* Effect.promise(() => fs.mkdir(anchorDir, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(anchorDir, ANCHOR_FILE), id))
        const result = yield* readAnchor(dir)
        expect(result).toBe(id)
      }),
    ),
  )

  it.live("trims whitespace/newlines when reading anchor id", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const id = mintId()
        const anchorDir = path.join(dir, ANCHOR_DIR)
        yield* Effect.promise(() => fs.mkdir(anchorDir, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(path.join(anchorDir, ANCHOR_FILE), `  ${id}\n`))
        const result = yield* readAnchor(dir)
        expect(result).toBe(id)
      }),
    ),
  )

  it.live("returns undefined on permission error (read failure degraded to undefined)", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const anchorDir = path.join(dir, ANCHOR_DIR)
        const anchorFile = path.join(anchorDir, ANCHOR_FILE)
        yield* Effect.promise(() => fs.mkdir(anchorDir, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(anchorFile, mintId()))
        // 移除读权限,测试结束后恢复(以便 tmpdir cleanup)
        const restore = Effect.promise(() => fs.chmod(anchorFile, 0o644))
        yield* Effect.promise(() => fs.chmod(anchorFile, 0o000))
        const result = yield* readAnchor(dir).pipe(Effect.ensuring(restore))
        expect(result).toBeUndefined()
      }),
    ),
  )
})

// ─── writeAnchor ─────────────────────────────────────────────────────────────

describe("writeAnchor", () => {
  it.live("writes anchor file and can be read back", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const id = mintId()
        yield* writeAnchor(dir, id)
        const result = yield* readAnchor(dir)
        expect(result).toBe(id)
      }),
    ),
  )

  it.live("creates anchor directory if it does not exist", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const id = mintId()
        yield* writeAnchor(dir, id)
        const anchorDir = path.join(dir, ANCHOR_DIR)
        const stat = yield* Effect.promise(() => fs.stat(anchorDir))
        expect(stat.isDirectory()).toBe(true)
      }),
    ),
  )

  it.live("overwrites existing anchor with new id", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const id1 = mintId()
        const id2 = mintId()
        yield* writeAnchor(dir, id1)
        yield* writeAnchor(dir, id2)
        const result = yield* readAnchor(dir)
        expect(result).toBe(id2)
      }),
    ),
  )

  it.live("degrades silently on read-only directory (does not throw)", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const id = mintId()
        // 设置目录只读
        yield* Effect.promise(() => fs.chmod(dir, 0o555))
        const restore = Effect.promise(() => fs.chmod(dir, 0o755))
        // writeAnchor 应降级不抛错
        yield* writeAnchor(dir, id).pipe(Effect.ensuring(restore))
        // 恢复权限后读锚应返回 undefined(因为写入失败了)
        const result = yield* readAnchor(dir)
        expect(result).toBeUndefined()
      }),
    ),
  )
})

// ─── appendToInfoExclude ──────────────────────────────────────────────────────

describe("appendToInfoExclude", () => {
  it.live("appends entry to .git/info/exclude when file already exists", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const infoDir = path.join(dir, "info")
        const excludeFile = path.join(infoDir, "exclude")
        yield* Effect.promise(() => fs.mkdir(infoDir, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(excludeFile, "# existing\n"))
        yield* appendToInfoExclude(dir, ".deskfox/")
        const content = yield* Effect.promise(() => fs.readFile(excludeFile, "utf8"))
        expect(content).toContain(".deskfox/")
        expect(content).toContain("# existing")
      }),
    ),
  )

  it.live("creates exclude file and parent directories if they do not exist", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const excludeFile = path.join(dir, "info", "exclude")
        // 确保文件不存在
        const existsBefore = yield* Effect.promise(() =>
          fs.stat(excludeFile).then(() => true).catch(() => false)
        )
        expect(existsBefore).toBe(false)
        yield* appendToInfoExclude(dir, ".deskfox/")
        const content = yield* Effect.promise(() => fs.readFile(excludeFile, "utf8"))
        expect(content).toContain(".deskfox/")
      }),
    ),
  )

  it.live("is idempotent: does not append duplicate entries", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        yield* appendToInfoExclude(dir, ".deskfox/")
        yield* appendToInfoExclude(dir, ".deskfox/")
        yield* appendToInfoExclude(dir, ".deskfox/")
        const excludeFile = path.join(dir, "info", "exclude")
        const content = yield* Effect.promise(() => fs.readFile(excludeFile, "utf8"))
        // 只应出现一次
        const count = (content.match(/\.deskfox\//g) || []).length
        expect(count).toBe(1)
      }),
    ),
  )

  it.live("degrades silently on write failure (does not throw)", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const infoDir = path.join(dir, "info")
        const excludeFile = path.join(infoDir, "exclude")
        yield* Effect.promise(() => fs.mkdir(infoDir, { recursive: true }))
        yield* Effect.promise(() => fs.writeFile(excludeFile, ""))
        // 设置文件只读
        yield* Effect.promise(() => fs.chmod(excludeFile, 0o444))
        const restore = Effect.promise(() => fs.chmod(excludeFile, 0o644))
        // appendToInfoExclude 应降级不抛错
        yield* appendToInfoExclude(dir, ".deskfox/").pipe(Effect.ensuring(restore))
        // 即使写入失败也不抛错,测试通过即可
      }),
    ),
  )

  it.live("handles file with no trailing newline before appending", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const infoDir = path.join(dir, "info")
        const excludeFile = path.join(infoDir, "exclude")
        yield* Effect.promise(() => fs.mkdir(infoDir, { recursive: true }))
        // 故意不加末尾换行
        yield* Effect.promise(() => fs.writeFile(excludeFile, "# no newline at end"))
        yield* appendToInfoExclude(dir, ".deskfox/")
        const content = yield* Effect.promise(() => fs.readFile(excludeFile, "utf8"))
        expect(content).toContain(".deskfox/")
        // 确保 .deskfox/ 在独立行(不紧跟在前一行末)
        expect(content).toMatch(/\n\.deskfox\/\n/)
      }),
    ),
  )
})

// ─── 集成断言:真 git repo 的 git status 干净 ─────────────────────────────────

describe("writeAnchor + appendToInfoExclude integration", () => {
  it.live("git status --porcelain shows no .deskfox after writeAnchor + appendToInfoExclude", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        // 真 git init
        yield* Effect.promise(() => execAsync("git init", { cwd: dir }))
        yield* Effect.promise(() => execAsync('git config user.email "test@test.com"', { cwd: dir }))
        yield* Effect.promise(() => execAsync('git config user.name "Test"', { cwd: dir }))
        // 创建一个初始 commit(否则 git status 可能报错)
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "README.md"), "test"))
        yield* Effect.promise(() => execAsync("git add README.md", { cwd: dir }))
        yield* Effect.promise(() => execAsync('git commit -m "init"', { cwd: dir }))

        // 调用写锚 + appendToInfoExclude
        const id = mintId()
        yield* writeAnchor(dir, id)
        // git store = .git 目录(非 worktree 分离场景)
        const gitStore = path.join(dir, ".git")
        yield* appendToInfoExclude(gitStore, ".deskfox/")

        // 验证 git status --porcelain 不包含 .deskfox
        const { stdout } = yield* Effect.promise(() => execAsync("git status --porcelain", { cwd: dir }))
        expect(stdout).not.toContain(".deskfox")

        // 验证锚文件确实写入了
        const read = yield* readAnchor(dir)
        expect(read).toBe(id)
      }),
    ),
  )
})

// ─── hideAnchorDir stub ───────────────────────────────────────────────────────

describe("hideAnchorDir", () => {
  it.live("is a no-op on macOS (dot-prefix naturally hidden)", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        // 不应抛错,不应有副作用
        yield* hideAnchorDir(dir)
        // 目录不应被创建
        const exists = yield* Effect.promise(() =>
          fs.stat(path.join(dir, ANCHOR_DIR)).then(() => true).catch(() => false)
        )
        expect(exists).toBe(false)
      }),
    ),
  )

  it.live("succeeds even when anchor dir does not exist", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        // 调用前目录不存在也不报错
        const result = yield* hideAnchorDir(dir)
        expect(result).toBeUndefined()
      }),
    ),
  )
})
