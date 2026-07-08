// FORK: REQ-072 复制项目独立展示 — 折叠竞态自愈效应(从 layout.tsx 抽出,便于单测)。
// 场景:旧版把副本目录误登记进 sandboxes,reconciler 会在实例 boot 前把刚打开的副本条目折叠掉;
// boot 后实例上报自身 worktree === 当前路由目录(= 该目录本身就是项目根)时,条目应存在 → 补回。
//
// 🔴 修复(2026-07-08):isListed 必须 untrack — 旧版把 projects.list() 也当依赖追踪,
// 用户右键「关闭」当前项目时 list 先变、路由还没切走,效应重跑发现 currentDir 不在列表里,
// 误判为"被折叠"又 open 回来 → 项目关不掉。自愈只该由「路由进入该目录」或「实例 boot 完成
// (bootedWorktree 变为 === directory)」驱动,列表本身的增删不是触发信号。
import { createEffect, untrack } from "solid-js"

export type ProjectRestoreDeps = {
  /** 当前路由目录(reactive,追踪) */
  currentDir: () => string
  /** 该目录实例上报的 worktree;boot 前为 undefined(reactive,追踪) */
  bootedWorktree: (directory: string) => string | undefined
  /** 目录是否已在项目列表(untrack 读取,列表增删不触发效应) */
  isListed: (directory: string) => boolean
  open: (directory: string) => void
}

export function createProjectRestoreEffect(deps: ProjectRestoreDeps) {
  createEffect(() => {
    const directory = deps.currentDir()
    if (!directory) return
    if (deps.bootedWorktree(directory) !== directory) return
    if (untrack(() => deps.isListed(directory))) return
    deps.open(directory)
  })
}
