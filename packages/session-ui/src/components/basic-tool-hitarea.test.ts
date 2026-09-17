// [bug-repro: 消息流里的工具折叠行(「写入 xxx.py」「已运行 N 条命令」「N 个文件已更改」)
//              整行都是可点区,宽窗口下右侧一大片空白同样触发展开 → 划过/拖选/随手一点频繁误触]
// REQ-128 · 2026-09-17 · [feat: release-closeout-2026-09]
//
// 这条修复是纯 CSS,行为验证在 e2e(142 条全过)与 S6 真机点击。
// 但它有一个**静默失效**的形态值得单独钉住:规则靠 .tool-collapsible 这个 class 命中,
// 一旦作用域覆盖被删、或有人把修法挪进上游全局 CSS,整行又变回可点 ——
// 没有任何报错,e2e 不跑就发现不了。

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const HERE = import.meta.dir
const CSS = readFileSync(join(HERE, "basic-tool.css"), "utf8")
const UI_COLLAPSIBLE_CSS = readFileSync(
  join(HERE, "..", "..", "..", "ui", "src", "components", "collapsible.css"),
  "utf8",
)

/** 取出 REQ-128 那段作用域覆盖 */
function hitAreaBlock() {
  const begin = CSS.indexOf("FORK-BEGIN: REQ-128")
  expect(begin).toBeGreaterThan(-1)
  const end = CSS.indexOf("FORK-END", begin)
  expect(end).toBeGreaterThan(begin)
  return CSS.slice(begin, end)
}

/** 同上,但剥掉注释 —— 断言"声明"时不能被解释性文字里的词误命中 */
function hitAreaDeclarations() {
  // 切片从 FORK-BEGIN 起,起点落在块注释内部 —— 先丢掉直到首个 */ 的部分,再清其余注释
  const block = hitAreaBlock()
  const afterLead = block.slice(block.indexOf("*/") + 2)
  return afterLead.replace(/\/\*[\s\S]*?\*\//g, "")
}

describe("REQ-128 工具折叠行命中区", () => {
  test("trigger 收成 fit-content —— 按钮本身就等于文字区", () => {
    const block = hitAreaBlock()
    expect(block).toContain('[data-slot="collapsible-trigger"]')
    expect(block).toMatch(/width:\s*fit-content/)
  })

  test("max-width 仍是 100% —— 长标题照旧在行宽处截断,不许撑破布局", () => {
    expect(hitAreaBlock()).toMatch(/max-width:\s*100%/)
  })

  test("作用域限定在 .tool-collapsible —— 非工具行共用同一个 collapsible,不能连坐", () => {
    expect(hitAreaBlock()).toContain(".tool-collapsible")
  })

  test("🔒 不采用 pointer-events 方案 —— 那会让「按钮边界」与「可点区域」脱节", () => {
    // 实测代价:13 条既有 e2e 当场变红(它们点 trigger 中心,而中心落在死区);
    // 且白名单要人肉枚举每个 .tool-collapsible 使用方,漏一个就是一处静默失效
    // (初版就漏了 context-tool-group,整组「已运行 N 条命令」完全点不开)。
    // 详见 docs/features/release-closeout-2026-09/2-plan.md D9。
    expect(hitAreaDeclarations()).not.toMatch(/pointer-events:\s*none/)
  })

  test("🔒 不动上游全局 CSS(packages/ui 是黑名单,且非工具行共用)", () => {
    // 若有人把 REQ-128 的修法挪进上游文件,这条会红 —— 提醒走 R4 override 流程,或改回作用域覆盖。
    expect(UI_COLLAPSIBLE_CSS).not.toContain("REQ-128")
    expect(UI_COLLAPSIBLE_CSS).not.toMatch(/width:\s*fit-content/)
  })

  test("🔒 上游 trigger 仍是 width:100%(本修法要覆盖的正是它;哪天上游自己改了,这条红了就该重新评估)", () => {
    expect(UI_COLLAPSIBLE_CSS).toMatch(/\[data-slot="collapsible-trigger"\]\s*\{[\s\S]*?width:\s*100%/)
  })

  test("hover 显箭头的规则仍在上游 trigger 上 —— trigger 缩窄后它正好只在文字/箭头上点亮", () => {
    expect(UI_COLLAPSIBLE_CSS).toMatch(/&:hover \[data-slot="collapsible-arrow"\]/)
  })
})
