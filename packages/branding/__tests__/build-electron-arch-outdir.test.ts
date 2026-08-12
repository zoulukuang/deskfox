// [bug-repro: build-deskfox-electron.sh 的 arch→产物目录映射与 electron-builder 实际行为相反,
//              致 x64 构建 EXIT=1(post-build 验证一行没跑)、arm64 验到上次残留包却报绿]
// 2026-08-12 — mac 2026.9.1 发版时撞出,详见 docs/installer-versions.md [macOS] 2026.9.1 段。
//
// 背景:electron-builder 的 mac 产物目录名不是我们定的,规则在 app-builder-lib/builder-util 里:
//   platformPackager.js:  appOutDir = "mac" + getArchSuffix(arch, defaultArch)
//   builder-util/arch.js: getArchSuffix = arch === defaultArchFromString(defaultArch) ? "" : "-" + Arch[arch]
//                         defaultArchFromString(undefined) === Arch.x64
// 我们的 electron-builder.deskfox.config.ts 未设 defaultArch → 默认 x64 →
//   x64 得空后缀(dist-deskfox/mac)、arm64 得 -arm64(dist-deskfox/mac-arm64)。
// 脚本原先写反成 arm64→mac / x64→mac-x64,后果双向:
//   x64  : mac-x64/ 不存在 → ls 失败 → set -euo pipefail 静默终止(EXIT=1,产物其实是好的,但守卫没跑)
//   arm64: 落到 mac/ = 上次 x64 构建残留 → 验错对象却报绿(假绿,守卫等于失效)
// 这个守卫的职责是"绝不发布不含 LibreOffice 的包",失效了就没有任何自动闸拦得住。
//
// 本测试守护三件事:① 映射不得再写反 ② lipo 架构名映射存在(lipo 报 x86_64 而非 x64,直接比会永远不匹配)
// ③ 架构断言块还在(防止有人把断言删掉退回"只看目录不看内容")。
// 另有一条:若本机能解析到 electron-builder 的 builder-util,则直接用它的真实规则反推期望值比对 ——
// 上游哪天改了命名规则,这条会红,提示同步更新脚本。

import { describe, expect, test } from "bun:test"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { Glob } from "bun"

const SCRIPTS = join(import.meta.dir, "..", "scripts")
const SH = readFileSync(join(SCRIPTS, "build-deskfox-electron.sh"), "utf8")

/** 从 `case "$ARCH" in ... esac` 块里抽出各分支的 MAC_APP_DIR 赋值 */
function macAppDirMapping(src: string): Record<string, string> {
  const start = src.indexOf('case "$ARCH" in')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf("esac", start)
  expect(end).toBeGreaterThan(start)
  const block = src.slice(start, end)
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/ARCH="(arm64|x64)";\s*LO_SUBDIR="[^"]*";\s*MAC_APP_DIR="([^"]+)"/g)) {
    out[m[1]] = m[2]
  }
  return out
}

describe("build-deskfox-electron.sh — arch → electron-builder 产物目录映射", () => {
  const mapping = macAppDirMapping(SH)

  test("解析到了两个架构的映射", () => {
    expect(Object.keys(mapping).sort()).toEqual(["arm64", "x64"])
  })

  test("x64 → dist-deskfox/mac(默认架构,无后缀)", () => {
    expect(mapping.x64).toBe("mac")
  })

  test("arm64 → dist-deskfox/mac-arm64(非默认架构,带后缀)", () => {
    expect(mapping.arm64).toBe("mac-arm64")
  })

  test("两者不得写反(原 bug 的精确形态)", () => {
    expect(mapping.arm64).not.toBe("mac")
    expect(mapping.x64).not.toBe("mac-x64")
  })
})

describe("build-deskfox-electron.sh — post-build 架构断言", () => {
  test("存在 lipo 架构名映射(lipo 报 x86_64,不是 x64)", () => {
    // 少了这层映射,x64 分支的断言会永远不匹配 → 每次 x64 构建都误报"架构不符"
    expect(SH).toMatch(/x64\)\s*LIPO_ARCH="x86_64"/)
    expect(SH).toMatch(/arm64\)\s*LIPO_ARCH="arm64"/)
  })

  test("对主可执行做架构断言(挡住验到残留包)", () => {
    expect(SH).toContain("APP_ARCHS")
    expect(SH).toMatch(/grep -qx "\$LIPO_ARCH"/)
  })

  test("架构不符时是硬失败(exit 1),不是继续往下走", () => {
    const i = SH.indexOf("产物架构与目标不符")
    expect(i).toBeGreaterThan(-1)
    // 该错误分支 200 字符内必须有 exit 1
    expect(SH.slice(i, i + 400)).toContain("exit 1")
  })

  test("内置 LibreOffice 也做架构断言(x64 包塞 arm64 soffice 会让 Intel 用户转换失败)", () => {
    expect(SH).toContain("内置 LibreOffice 架构与目标不符")
  })
})

// 与上游真实规则对表:能解析到 builder-util 才跑,否则跳过(不同机器 node_modules 布局可能不同)
const arcJs = [...new Glob("**/builder-util/out/arch.js").scanSync({
  cwd: join(import.meta.dir, "..", "..", "..", "node_modules", ".bun"),
  absolute: true,
  onlyFiles: true,
})][0]

describe("与 electron-builder 真实命名规则对表", () => {
  test.skipIf(!arcJs || !existsSync(arcJs))("脚本映射 == getArchSuffix 推导值", async () => {
    const mod: any = require(arcJs!)
    const mapping = macAppDirMapping(SH)
    // 未设 defaultArch → 传 undefined,与我们的 config 现状一致
    expect("mac" + mod.getArchSuffix(mod.Arch.x64, undefined)).toBe(mapping.x64)
    expect("mac" + mod.getArchSuffix(mod.Arch.arm64, undefined)).toBe(mapping.arm64)
  })
})
