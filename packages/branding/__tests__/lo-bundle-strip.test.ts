// [bug-repro: bundled LibreOffice 删 presets/ 致新用户首启 "User installation could not be completed"]
// 2026-06-07 — LO bundle 剥皮防回归守护(静态读脚本断言,无需 build / 无需 soffice,CI 可跑)
//
// 背景:打包内置的 LibreOffice 经 prepare-lo-bundle.{sh,ps1} 剥皮瘦身。其中 presets/ 与
// share/extensions/ 是 LO 首次为新用户创建 user profile(UserInstallation)时的初始模板/骨架来源。
// 整删任一目录 → soffice bootstrap 阶段报 Fatal Error: "User installation could not be completed"
// (--headless 下仍弹窗,因失败早于 headless 生效)。Mac 端 2026-06-07 三组对照实测坐实:
//   B 剥皮 bundle → 失败(exit 77);A 原始完整 LO → 成功;C 剥皮 + 加回 presets → 成功。
// extensions 在 2026-06-03 已修(留空骨架),presets 是残留真因(解释 Win 2026.7.0 仍复现)。
//
// 本测试守护两脚本:① 删除清单里不得再出现 presets ② extensions 不得被整目录删除
// (须走"删内容留骨架")。任一回归即红,挡住"剥皮过度→线上 fatal error"再次发生。

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SCRIPTS = join(import.meta.dir, "..", "scripts")
const SH = readFileSync(join(SCRIPTS, "prepare-lo-bundle.sh"), "utf8")
const PS1 = readFileSync(join(SCRIPTS, "prepare-lo-bundle.ps1"), "utf8")

/** 从脚本里截取数组字面量块(open .. 对应的闭合 `)`),返回块内所有双引号字符串字面量 */
function quotedEntriesInBlock(src: string, openMarker: string): string[] {
  const start = src.indexOf(openMarker)
  if (start < 0) throw new Error(`找不到数组块起始标记: ${openMarker}`)
  const end = src.indexOf(")", start)
  if (end < 0) throw new Error(`数组块未闭合: ${openMarker}`)
  const block = src.slice(start + openMarker.length, end)
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

describe("prepare-lo-bundle.sh (macOS) 剥皮清单", () => {
  const stripDirs = quotedEntriesInBlock(SH, "STRIP_DIRS=(")

  test("解析到了正确的数组块(含已知剥皮项 help/gallery)", () => {
    expect(stripDirs).toContain("help")
    expect(stripDirs).toContain("gallery")
  })

  test("不得删除 presets(profile 初始模板源)", () => {
    expect(stripDirs.map((s) => s.toLowerCase())).not.toContain("presets")
  })

  test("不得删除 extensions(须留骨架)", () => {
    expect(stripDirs.map((s) => s.toLowerCase())).not.toContain("extensions")
  })

  test("extensions 走删内容留骨架(mindepth 1,不整删目录本体)", () => {
    expect(SH).toMatch(/find\s+"\$EXT_DIR"\s+-mindepth\s+1/)
  })
})

describe("prepare-lo-bundle.ps1 (Windows) 剥皮清单", () => {
  const stripFolders = quotedEntriesInBlock(PS1, "$stripFolders = @(")

  test("解析到了正确的数组块(含已知剥皮项 help)", () => {
    expect(stripFolders).toContain("help")
  })

  test("不得删除 presets(profile 初始模板源)", () => {
    expect(stripFolders.map((s) => s.toLowerCase())).not.toContain("presets")
  })

  test("不得删除 share\\extensions(须留骨架)", () => {
    expect(stripFolders.map((s) => s.toLowerCase())).not.toContain("share\\extensions")
    expect(stripFolders.map((s) => s.toLowerCase())).not.toContain("extensions")
  })

  test("extensions 走删内容留骨架(Get-ChildItem $extDir | Remove-Item,不整删目录)", () => {
    expect(PS1).toMatch(/\$extDir\s*=\s*Join-Path\s+\$loBaseDir\s+"share\\extensions"/)
  })
})
