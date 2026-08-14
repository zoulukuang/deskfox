// [fork-only] 文件树行重挂后补焦点 [feat: filetree-shortcut-focus-scope] 2026-08-13
//
// [bug-repro: 点文件行后 activeElement 变回 body(点目录行则正常)。根因是行在成为 active 后
//   被 Tooltip 分支重挂,DOM 节点销毁重建,handleClick 里设的焦点随之丢失。
//   本测试直接复现「重挂」这一步:先聚焦行 → 用新节点替换它 → 断言补焦点能把焦点找回来。]
import { describe, test, expect, beforeEach } from "bun:test"

import { restoreRowFocus } from "./file-tree-focus"

function mountTree(paths: string[]) {
  const tree = document.createElement("div")
  tree.setAttribute("data-component", "filetree")
  for (const p of paths) {
    const row = document.createElement("button")
    row.setAttribute("data-tree-path", p)
    row.tabIndex = 0
    tree.appendChild(row)
  }
  document.body.appendChild(tree)
  return tree
}

/** 复现组件里的「行被重挂」:同 path 的新节点替换旧节点。
 *  这里**遍历取节点而不是拼选择器** —— 第一版拼了字符串,遇到带引号的路径直接抛
 *  "not a valid selector",反倒证明了被测函数里那层转义是必要的。 */
function remount(tree: HTMLElement, path: string) {
  const old = [...tree.children].find((e) => e.getAttribute("data-tree-path") === path)!
  const fresh = document.createElement("button")
  fresh.setAttribute("data-tree-path", path)
  fresh.tabIndex = 0
  old.replaceWith(fresh)
  return fresh
}

describe("文件树行重挂后补焦点", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  test("行被重挂导致焦点掉回 body → 补得回来(正向)", () => {
    const tree = mountTree(["README.md", "docs/"])
    const row = tree.querySelector('[data-tree-path="README.md"]') as HTMLElement
    row.focus()
    expect(document.activeElement).toBe(row)

    const fresh = remount(tree, "README.md")
    expect(document.activeElement).toBe(document.body) // 复现:焦点确实丢了

    expect(restoreRowFocus("README.md")).toBe(true)
    expect(document.activeElement).toBe(fresh)
    expect((document.activeElement as Element).closest('[data-component="filetree"]')).toBe(tree)
  })

  test("用户已把焦点移到别处 → **不抢回来**(反向:这才是补焦点的边界)", () => {
    mountTree(["README.md"])
    const outside = document.createElement("textarea")
    document.body.appendChild(outside)
    outside.focus()
    expect(document.activeElement).toBe(outside)

    expect(restoreRowFocus("README.md")).toBe(false)
    expect(document.activeElement).toBe(outside)
  })

  test("路径不存在 → 安全返回 false,不抛错(反向)", () => {
    mountTree(["README.md"])
    expect(restoreRowFocus("不存在的文件.md")).toBe(false)
  })

  test("带引号等特殊字符的路径也能命中(选择器需转义)", () => {
    const tree = mountTree(['weird"name.md'])
    remount(tree, 'weird"name.md')
    expect(restoreRowFocus('weird"name.md')).toBe(true)
    expect((document.activeElement as Element).getAttribute("data-tree-path")).toBe('weird"name.md')
  })
})
