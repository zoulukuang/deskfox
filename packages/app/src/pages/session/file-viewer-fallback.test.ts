// [bug-repro: 应用重启后恢复出来的激活 tab 内容区一片空白 —— 没有错误、没有 loading、
//             没有任何线索;点别的 tab 再点回来才正常。文件被移走/改名/删除时同样一片白]
// 2026-09-17 · [feat: release-closeout-2026-09] · user 真机截图反馈
//
// 根因两层,都写进断言:
//   ① FileTabContent **自己不加载**文件,加载由外部 session-side-panel 的 activateTab /
//      previewTab 调 file.load 驱动。恢复出来的 tab 不经过那两条路径 → file.get() 返回
//      undefined → 内容区什么都没有。
//   ② 渲染用的 <Switch> 只有 loaded / loading / error 三个 <Match>、**没有兜底** ——
//      三条全不匹配时 Switch 一个节点都不渲染,于是"静默变成一片白"。
//
// 这类"静默失败"是本批反复踩到的同一族(0.0.0 是合法 semver / abort 传不到 fetch /
// 漏了第二条渲染路径),所以用结构闸钉住,别再退回去。

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = readFileSync(join(import.meta.dir, "file-tabs.tsx"), "utf8")

/** 取出**内容区**那个 Switch —— 文件里还有个 md 右键菜单的 Switch,不能按位置猜,
 *  以「包含 state()?.loaded 分支」为锚定位。 */
function viewerSwitch() {
  const marker = SRC.indexOf("state()?.loaded}>")
  expect(marker).toBeGreaterThan(-1)
  const begin = SRC.lastIndexOf("<Switch>", marker)
  expect(begin).toBeGreaterThan(-1)
  const end = SRC.indexOf("</Switch>", marker)
  expect(end).toBeGreaterThan(begin)
  return SRC.slice(begin, end)
}

describe("文件预览内容区不得静默空白", () => {
  test("① FileTabContent 挂载时自己触发一次加载(恢复出来的 tab 没人替它调)", () => {
    expect(SRC).toMatch(/onMount\(\(\) => \{[\s\S]{0,200}file\.load\(/)
  })

  test("② Switch 有兜底分支 —— loaded / loading / error 之外的状态也要有可读输出", () => {
    const block = viewerSwitch()
    expect(block).toContain("fileViewer.unavailable.title")
    expect(block).toContain("fileViewer.unavailable.description")
  })

  test("② 兜底分支的条件覆盖「三条都不成立」", () => {
    const block = viewerSwitch()
    expect(block).toMatch(/!state\(\)\?\.loaded\s*&&\s*!state\(\)\?\.loading\s*&&\s*!state\(\)\?\.error/)
  })

  test("兜底里把路径显出来 —— 文件被移走时用户得知道是哪个路径没了", () => {
    expect(viewerSwitch()).toMatch(/\{path\(\)\}/)
  })

  test("原有三个分支一个都不能少(兜底不是用来替代它们的)", () => {
    const block = viewerSwitch()
    expect(block).toContain("state()?.loaded")
    expect(block).toContain("state()?.loading")
    expect(block).toContain("state()?.error")
  })
})
