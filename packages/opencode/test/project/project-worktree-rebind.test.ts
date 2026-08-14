// FORK: REQ-061/064 [feat: v2026.8.2] —— 服务端集成测:磁盘改名/移动后用实际路径重开项目,
//   fromDirectory 应把 DB 里指向旧路径的 worktree 重绑到新路径(git-id 命中同一行);
//   且旧 worktree 仍存在时绝不误绑。补 U3 的回归(原修复只手测过 sidecar API,无自动回归)。
import { describe, expect } from "bun:test"
import { Project } from "@/project/project"
import { $ } from "bun"
import path from "path"
import { tmpdirScoped } from "../fixture/fixture"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { testEffect } from "../lib/effect"

// 2026-08-11 sync v1.17.13:上游 layer→node 体系
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
const it = testEffect(AppNodeBuilder.build(LayerNode.group([Project.node, Database.node, CrossSpawnSpawner.node])))

async function gitRepoWithCommit(dir: string) {
  await $`mkdir -p ${dir}`.quiet()
  await $`git init`.cwd(dir).quiet()
  // 带一次 commit → 有 root commit → 非-global 稳定 projectID(改名前后同一 id)
  await $`git -c user.email=t@example.com -c user.name=test commit --allow-empty -m init`.cwd(dir).quiet()
}

describe("Project.fromDirectory worktree rebind (REQ-061/064 v2026.8.2)", () => {
  it.live("rebinds worktree to the new path after the folder is renamed on disk", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const orig = path.join(root, "orig")
      const renamed = path.join(root, "renamed-after-move")

      yield* Effect.promise(() => gitRepoWithCommit(orig))

      const first = yield* project.fromDirectory(orig)
      expect(first.project.worktree).toBe(orig)
      const projectID = first.project.id

      // 磁盘改名:旧 worktree(orig)在磁盘上不再存在
      yield* Effect.promise(() => $`mv ${orig} ${renamed}`.quiet())

      // 用新路径重开 —— git-id 命中同一行,旧 worktree 已不存在 → 重绑到新路径
      const second = yield* project.fromDirectory(renamed)
      expect(second.project.id).toBe(projectID) // 同一项目(命中旧行,非新建)
      expect(second.project.worktree).not.toBe(orig) // 不再是已消失的旧路径
      expect(second.project.worktree.endsWith("renamed-after-move")).toBe(true)
    }),
  )

  it.live("does not rebind when the existing worktree still exists (no误伤正常项目)", () =>
    Effect.gen(function* () {
      const project = yield* Project.Service
      const root = yield* tmpdirScoped()
      const dir = path.join(root, "stable")

      yield* Effect.promise(() => gitRepoWithCommit(dir))

      const first = yield* project.fromDirectory(dir)
      // 重开同一个仍存在的目录:worktree 不应变(旧 worktree 还在,不触发重绑)
      const second = yield* project.fromDirectory(dir)
      expect(second.project.id).toBe(first.project.id)
      expect(second.project.worktree).toBe(first.project.worktree)
    }),
  )
})
