// FORK: REQ-069 [feat: req069-folder-identity] —— fromDirectory 非git 文件夹稳定身份编排集成测。
//   复用 project-worktree-rebind / migrate-global 现成 harness(真跑 git + tmpdir)。
//   覆盖 U4 acceptance 七条:flag 门控两态 / 铸锚判定钉死 / 两路写锚(git status 干净)/
//   析出行真实 worktree / 副本共享(worktree+sandboxes 断言)/ 改名挪位重绑 / git⇄非git 连续。
import { describe, expect } from "bun:test"
import { Project } from "@/project/project"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { $ } from "bun"
import path from "path"
import { promises as fsp } from "fs"
import { tmpdirScoped } from "../fixture/fixture"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2Bridge } from "@/event-v2-bridge"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { AppProcess } from "@opencode-ai/core/process"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProjectDirectories } from "@opencode-ai/core/project/directories"
import { EventV2 } from "@opencode-ai/core/event"
import { Git } from "@opencode-ai/core/git"
import { ANCHOR_DIR, ANCHOR_FILE } from "@opencode-ai/core/project/anchor"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

// Project layer 带 flag override —— Project.defaultLayer 内部 provide 了 RuntimeFlags.defaultLayer,
// 无法从外部 merge 覆盖;故基于 Project.layer 手工 provide 各默认子层 + RuntimeFlags.layer({override})。
const projectLayerWithFlag = (nonGitFolderIdentity: boolean) =>
  Project.layer.pipe(
    Layer.provide(RuntimeFlags.layer({ nonGitFolderIdentity })),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(ProjectV2.defaultLayer),
    // FORK: 上游删除 ProjectCopy.defaultLayer,按上游 core/test/project-copy.test.ts 范式等价组装(2026-08-11 sync v1.17.8)
    Layer.provide(
      ProjectCopy.layer.pipe(
        Layer.provide(Database.defaultLayer),
        Layer.provide(ProjectDirectories.defaultLayer),
        Layer.provide(EventV2.defaultLayer),
        Layer.provide(FSUtil.defaultLayer),
        Layer.provide(Git.defaultLayer),
      ),
    ),
    Layer.provide(AppProcess.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(Database.defaultLayer),
  )

const baseLayer = (flag: boolean) =>
  Layer.mergeAll(projectLayerWithFlag(flag), Database.defaultLayer, CrossSpawnSpawner.defaultLayer)

const itOn = testEffect(baseLayer(true))
const itOff = testEffect(baseLayer(false))

const anchorPath = (dir: string) => path.join(dir, ANCHOR_DIR, ANCHOR_FILE)
const readAnchorFile = (dir: string) =>
  fsp.readFile(anchorPath(dir), "utf8").then(
    (c) => c.trim(),
    () => undefined,
  )

async function gitRepoWithCommit(dir: string) {
  await $`git init`.cwd(dir).quiet()
  await $`git -c user.email=t@example.com -c user.name=test commit --allow-empty -m init`.cwd(dir).quiet()
}

const GLOBAL = ProjectV2.ID.global

describe("REQ-069 fromDirectory non-git folder identity orchestration", () => {
  // ─── ① flag 门控:关时磁盘已有锚 → 项目仍按 global 打开 ───────────────────────
  describe("flag gate (B4)", () => {
    itOff.live("flag OFF: existing anchor on disk is ignored, project opens as global", () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        const dir = yield* tmpdirScoped()
        // 预置磁盘锚(模拟改造前用户 / 别处开过)
        yield* Effect.promise(async () => {
          await fsp.mkdir(path.join(dir, ANCHOR_DIR), { recursive: true })
          await fsp.writeFile(anchorPath(dir), "fld_deadbeefdeadbeefdeadbeefdeadbeef\n")
        })

        const { project: p } = yield* project.fromDirectory(dir)
        // flag 关 → 忽略锚 id,强制 global、worktree="/"(行为=改造前)
        expect(p.id).toBe(GLOBAL)
        expect(p.worktree).toBe("/")
        // 不铸 id、不覆盖锚(锚内容保持原样)
        expect(yield* Effect.promise(() => readAnchorFile(dir))).toBe("fld_deadbeefdeadbeefdeadbeefdeadbeef")
      }),
    )

    itOff.live("flag OFF: plain non-git folder without anchor opens as global (bit-identical baseline)", () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        const dir = yield* tmpdirScoped()
        const { project: p } = yield* project.fromDirectory(dir)
        expect(p.id).toBe(GLOBAL)
        expect(p.worktree).toBe("/")
        // 未写锚
        expect(yield* Effect.promise(() => readAnchorFile(dir))).toBeUndefined()
      }),
    )
  })

  // ─── ② 铸锚判定 + 析出行真实 worktree(B5) ───────────────────────────────────
  describe("mint decision + carve-out worktree (B5)", () => {
    itOn.live("flag ON + non-git + no anchor: mints fld_ id, row worktree = real dir, writes anchor", () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        const dir = yield* tmpdirScoped()

        const { project: p } = yield* project.fromDirectory(dir)
        // 铸新 id(非 global,fld_ 前缀)
        expect(p.id).not.toBe(GLOBAL)
        expect(p.id.startsWith("fld_")).toBe(true)
        // 析出行 worktree = 真实目录(不是盘根 "/")
        expect(p.worktree).toBe(dir)
        // 锚已落盘,内容 = 新 id
        expect(yield* Effect.promise(() => readAnchorFile(dir))).toBe(p.id)
      }),
    )

    itOn.live("flag ON + git init WITHOUT commit: has vcs → never mints, stays global", () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        const dir = yield* tmpdirScoped()
        // git init 但不 commit → data.vcs 有值、id=global → 绝不触发 mint
        yield* Effect.promise(() => $`git init`.cwd(dir).quiet())

        const { project: p } = yield* project.fromDirectory(dir)
        expect(p.id).toBe(GLOBAL)
        // 未铸 fld_ id、未写锚(mint 判定 !data.vcs 不满足)
        expect(yield* Effect.promise(() => readAnchorFile(dir))).toBeUndefined()
      }),
    )

    itOn.live("flag ON: reopening a minted non-git folder reuses the same fld_ id (anchor round-trip)", () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        const dir = yield* tmpdirScoped()

        const first = yield* project.fromDirectory(dir)
        const second = yield* project.fromDirectory(dir)
        // 第二次经 resolve 读锚 → 同 id,不重铸
        expect(second.project.id).toBe(first.project.id)
        expect(second.project.worktree).toBe(dir)
      }),
    )
  })

  // ─── ③ 复制对齐 git:副本同锚共享,worktree/sandboxes 钉死 ─────────────────────
  describe("copy shares identity (aligns with git double-clone)", () => {
    // FORK: REQ-072 复制项目独立展示改判 — 副本自身是身份根,不再登记 sandboxes(否则前端折叠跳回原目录);
    // 独立展示 + session 因同 id 共享。详见 project-copy-standalone.test.ts 全景用例。2026-07-05
    itOn.live("flag ON: copying a minted folder shares id; original worktree kept, copy stays standalone", () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        const root = yield* tmpdirScoped()
        const orig = path.join(root, "orig")
        const copy = path.join(root, "copy")
        yield* Effect.promise(() => fsp.mkdir(orig, { recursive: true }))

        const first = yield* project.fromDirectory(orig)
        const id = first.project.id
        expect(id.startsWith("fld_")).toBe(true)
        expect(first.project.worktree).toBe(orig)

        // 副本 = 连 .deskfox/id 一起复制(副本非改名:orig 磁盘仍在)
        yield* Effect.promise(() => $`cp -R ${orig} ${copy}`.quiet())

        const second = yield* project.fromDirectory(copy)
        // 三者钉死:同 id / worktree 保持首开路径(不重绑,orig 仍在)/ 副本独立不进 sandboxes(REQ-072)
        expect(second.project.id).toBe(id)
        expect(second.project.worktree).toBe(orig)
        expect(second.project.sandboxes).not.toContain(copy)
        expect(second.project.worktree).not.toBe(copy)
      }),
    )
  })

  // ─── ④ 两路写锚:git 项目写锚 + git status 干净 ──────────────────────────────
  describe("two-path anchor write (continuity token)", () => {
    itOn.live("flag ON: git project opens → .deskfox/id exists, content=id, git status --porcelain clean", () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        const dir = yield* tmpdirScoped()
        yield* Effect.promise(() => gitRepoWithCommit(dir))

        const { project: p } = yield* project.fromDirectory(dir)
        expect(p.id).not.toBe(GLOBAL)
        // 锚存在且内容 = 项目 id
        expect(yield* Effect.promise(() => readAnchorFile(dir))).toBe(p.id)
        // .deskfox/ 已进 .git/info/exclude → git status 干净
        const status = yield* Effect.promise(() => $`git status --porcelain`.cwd(dir).quiet().text())
        expect(status.trim()).toBe("")
      }),
    )

    itOff.live("flag OFF: git project does NOT get an anchor written", () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        const dir = yield* tmpdirScoped()
        yield* Effect.promise(() => gitRepoWithCommit(dir))

        yield* project.fromDirectory(dir)
        expect(yield* Effect.promise(() => readAnchorFile(dir))).toBeUndefined()
      }),
    )
  })

  // ─── ⑤ 改名/挪位:锚 id 不变 → 命中既有行 → REQ-061 三态重绑 → worktree 跟随 ──
  describe("rename/move rebind (REQ-061 tri-state, anchor id stable)", () => {
    itOn.live("flag ON: renaming a minted non-git folder keeps id, rebinds worktree to new path", () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        const root = yield* tmpdirScoped()
        const orig = path.join(root, "orig")
        const renamed = path.join(root, "renamed")
        yield* Effect.promise(() => fsp.mkdir(orig, { recursive: true }))

        const first = yield* project.fromDirectory(orig)
        const id = first.project.id
        expect(first.project.worktree).toBe(orig)

        // 磁盘改名(锚随目录一起搬,orig 不再存在)
        yield* Effect.promise(() => $`mv ${orig} ${renamed}`.quiet())

        const second = yield* project.fromDirectory(renamed)
        expect(second.project.id).toBe(id) // 锚 id 不变 → 命中既有行
        expect(second.project.worktree).toBe(renamed) // 旧路径 ENOENT → 重绑到新路径
      }),
    )
  })

  // ─── ⑥ git⇄非git 转换连续 ────────────────────────────────────────────────────
  describe("git ⇄ non-git conversion continuity", () => {
    itOn.live("flag ON: non-git → git init+commit keeps same anchor id (same project)", () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        const dir = yield* tmpdirScoped()

        // 先作为非git 打开 → 铸锚
        const before = yield* project.fromDirectory(dir)
        const id = before.project.id
        expect(id.startsWith("fld_")).toBe(true)

        // 转成 git(init + commit)。resolve git 分支 id 全序:remote > cached > 锚id > root。
        // 无 remote / 无 .git/opencode cache → 落到锚 id → 同项目连续。
        yield* Effect.promise(() => gitRepoWithCommit(dir))

        const after = yield* project.fromDirectory(dir)
        expect(after.project.id).toBe(id) // 锚 id 承接,身份连续
        expect(after.project.vcs).toBe("git")
      }),
    )

    itOn.live("flag ON: git → remove .git keeps same id via anchor (same project)", () =>
      Effect.gen(function* () {
        const project = yield* Project.Service
        const dir = yield* tmpdirScoped()
        yield* Effect.promise(() => gitRepoWithCommit(dir))

        // git 打开 → 写锚(锚内容 = git 项目 id)
        const before = yield* project.fromDirectory(dir)
        const id = before.project.id
        expect(id).not.toBe(GLOBAL)

        // 删 .git → 变非git,但锚仍在 → resolve 无 repo 走「有锚」分支返锚 id
        yield* Effect.promise(() => $`rm -rf ${path.join(dir, ".git")}`.quiet())

        const after = yield* project.fromDirectory(dir)
        expect(after.project.id).toBe(id) // 锚承接,身份连续
        expect(after.project.vcs).toBeUndefined()
        expect(after.project.worktree).toBe(dir)
      }),
    )
  })
})
