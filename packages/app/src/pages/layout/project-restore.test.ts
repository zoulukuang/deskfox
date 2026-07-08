import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createProjectRestoreEffect, type ProjectRestoreDeps } from "./project-restore"

const DIR_A = "D:/work/project-a"
const DIR_B = "D:/work/project-b"

/** 搭一个最小 reactive 环境:项目列表 + 当前路由目录 + 各目录 boot 状态 */
function setup(initial: { list: string[]; dir: string; booted: string[] }) {
  return createRoot((dispose) => {
    const [list, setList] = createSignal(initial.list)
    const [dir, setDir] = createSignal(initial.dir)
    const [booted, setBooted] = createSignal(new Set(initial.booted))
    const opened: string[] = []

    const deps: ProjectRestoreDeps = {
      currentDir: dir,
      bootedWorktree: (directory) => (booted().has(directory) ? directory : undefined),
      isListed: (directory) => list().includes(directory),
      open: (directory) => {
        opened.push(directory)
        setList((prev) => [...prev, directory])
      },
    }
    createProjectRestoreEffect(deps)

    return { setList, setDir, setBooted, opened, dispose }
  })
}

describe("createProjectRestoreEffect", () => {
  // bug 复现:右键「关闭」当前项目 → list 先变、路由还没切走。
  // 旧实现追踪 list,效应重跑发现 currentDir 不在列表 → 误 open 补回,项目关不掉。
  test("关闭当前项目(路由未切走)不会被误补回", () => {
    const t = setup({ list: [DIR_A, DIR_B], dir: DIR_A, booted: [DIR_A, DIR_B] })

    t.setList([DIR_B])

    expect(t.opened).toEqual([])
    t.dispose()
  })

  test("关闭当前项目后路由切到下一项目,已关闭项目仍不补回", () => {
    const t = setup({ list: [DIR_A, DIR_B], dir: DIR_A, booted: [DIR_A, DIR_B] })

    t.setList([DIR_B])
    t.setDir(DIR_B)

    expect(t.opened).toEqual([])
    t.dispose()
  })

  test("关闭最后一个项目(随后路由回首页)不会被误补回", () => {
    const t = setup({ list: [DIR_A], dir: DIR_A, booted: [DIR_A] })

    t.setList([])
    t.setDir("")

    expect(t.opened).toEqual([])
    t.dispose()
  })

  // 回归保护:REQ-072 原始场景 — 副本目录被 reconciler 折叠掉,boot 完成上报
  // worktree === 当前路由目录时要补回。
  test("REQ-072 折叠竞态:boot 完成后条目缺失 → 补回", () => {
    const t = setup({ list: [DIR_B], dir: DIR_A, booted: [] })

    // boot 前:worktree 未知,不动作
    expect(t.opened).toEqual([])

    // boot 完成:实例上报该目录本身就是项目根 → 补回
    t.setBooted(new Set([DIR_A]))

    expect(t.opened).toEqual([DIR_A])
    t.dispose()
  })

  test("路由进入未列出的已 boot 目录 → 补回", () => {
    const t = setup({ list: [DIR_B], dir: "", booted: [DIR_A, DIR_B] })

    t.setDir(DIR_A)

    expect(t.opened).toEqual([DIR_A])
    t.dispose()
  })

  test("目录已在列表时不重复 open", () => {
    const t = setup({ list: [DIR_A], dir: "", booted: [DIR_A] })

    t.setDir(DIR_A)

    expect(t.opened).toEqual([])
    t.dispose()
  })
})
