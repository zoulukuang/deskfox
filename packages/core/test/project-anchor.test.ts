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

// 用真实文件系统跑 IO 测试(2026-08-11 sync v1.17.13:上游 layer→node 体系,defaultLayer 移除)
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
const fsLayer = AppNodeBuilder.build(LayerNode.group([FSUtil.node]))

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

  // FORK: win-anchor-hide-case-fold — 读失败注入改用「id 路径是目录」(EISDIR,mac/win 均可移植)。
  //   原 chmod 0o000 在 Windows 上不移除读权限 → 读仍成功 → 测试在 Win 上假失败。行为断言不变。 2026-07-07
  it.live("returns undefined on read failure (degraded to undefined)", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const anchorDir = path.join(dir, ANCHOR_DIR)
        const anchorFile = path.join(anchorDir, ANCHOR_FILE)
        // 把 id 造成目录 → readFileString 读它必失败(EISDIR),跨平台一致
        yield* Effect.promise(() => fs.mkdir(anchorFile, { recursive: true }))
        const result = yield* readAnchor(dir)
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

  // FORK: win-anchor-hide-case-fold — 写失败注入改用「父路径是文件」(ENOTDIR,mac/win 均可移植)。
  //   原 chmod 0o555 在 Windows 上不阻止在只读目录下建文件 → 写仍成功 → 测试在 Win 上假失败。 2026-07-07
  it.live("degrades silently on write failure (does not throw)", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const id = mintId()
        // 造一个文件当「父目录」→ writeWithDirs 无法在其下 mkdir → 写失败但降级不抛
        const blocker = path.join(dir, "blocker")
        yield* Effect.promise(() => fs.writeFile(blocker, "x"))
        yield* writeAnchor(blocker, id)
        // 读锚应返回 undefined(因为写入失败了)
        const result = yield* readAnchor(blocker)
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

// ─── hideAnchorDir 平台薄层(win-anchor-hide-case-fold 阶段二) ─────────────────

describe("hideAnchorDir", () => {
  // TC-H2:非 win32 平台 no-op —— 不调隐藏执行器(macOS/Linux 点目录天然隐藏)
  it.live("is a no-op on non-win32 platforms (does not invoke setHidden)", () =>
    Effect.gen(function* () {
      let called = 0
      yield* hideAnchorDir("/some/dir", {
        platform: "darwin",
        setHidden: async () => {
          called++
        },
      })
      expect(called).toBe(0)
    }),
  )

  // TC-H1(隐藏侧):win32 → 对 <dir>/.deskfox 调 attrib(隐藏执行器),路径正确
  it.live("invokes setHidden on the .deskfox dir on win32", () =>
    Effect.gen(function* () {
      const targets: string[] = []
      yield* hideAnchorDir(path.join("C:", "Proj"), {
        platform: "win32",
        setHidden: async (t) => {
          targets.push(t)
        },
      })
      expect(targets.length).toBe(1)
      expect(targets[0]).toBe(path.join("C:", "Proj", ANCHOR_DIR))
    }),
  )

  // TC-H3:隐藏执行器失败(attrib 不存在/权限)→ 降级不抛错
  it.live("degrades silently when setHidden rejects (win32)", () =>
    Effect.gen(function* () {
      // 若抛错会让 Effect fail → it.live 判失败;能跑到断言即证明已降级
      const result = yield* hideAnchorDir("C:\\Proj", {
        platform: "win32",
        setHidden: async () => {
          throw new Error("attrib not found")
        },
      })
      expect(result).toBeUndefined()
    }),
  )

  it.live("returns void without creating any directory", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        // 用真实默认执行器(当前平台);无论平台都不应创建目录
        const result = yield* hideAnchorDir(dir)
        const exists = yield* Effect.promise(() =>
          fs.stat(path.join(dir, ANCHOR_DIR)).then(() => true).catch(() => false)
        )
        expect(result).toBeUndefined()
        expect(exists).toBe(false)
      }),
    ),
  )
})

// ─── writeAnchor → hideAnchorDir 接线(写成功才隐藏) ──────────────────────────

describe("writeAnchor hide wiring", () => {
  // TC-H1(写侧):写成功 → hide 被调用一次,参数为项目目录
  it.live("calls hide with project dir after a successful write", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        const hidden: string[] = []
        yield* writeAnchor(dir, mintId(), (d) =>
          Effect.sync(() => {
            hidden.push(d)
          }),
        )
        expect(hidden).toEqual([dir])
      }),
    ),
  )

  // TC-H4:写失败 → 不调 hide(无锚可隐藏),且不抛错。
  // 失败注入用「父路径是文件」(ENOTDIR,mac/win 均可移植;chmod 只读在 Windows 对目录/读权限 no-op)。
  it.live("does not call hide when the write fails", () =>
    withTmpdir((dir) =>
      Effect.gen(function* () {
        let called = 0
        // 造一个文件当「父目录」→ writeWithDirs 无法在其下 mkdir .deskfox → 写失败
        const blocker = path.join(dir, "blocker")
        yield* Effect.promise(() => fs.writeFile(blocker, "x"))
        yield* writeAnchor(blocker, mintId(), () =>
          Effect.sync(() => {
            called++
          }),
        )
        expect(called).toBe(0)
      }),
    ),
  )
})
