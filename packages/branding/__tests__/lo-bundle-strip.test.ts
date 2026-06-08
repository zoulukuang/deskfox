// [bug-repro: bundled LibreOffice 删 presets/ 致新用户首启 "User installation could not be completed"]
// 2026-06-07 — LO bundle 剥皮防回归守护(静态读脚本断言,无需 build / 无需 soffice)
// CI 接入:branding package.json 加 test:ci 脚本 + turbo.json 注册 @opencode-ai/branding#test:ci,
// 故 `bun turbo test:ci`(CI test.yml)会真跑本测试;否则它只在手动 `bun test` 时运行,守护形同虚设。
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

// 守护"冷启动 smoke gate"本身不被删 —— 这是比黑名单更根本的机制:剥皮后用全新空 profile 真跑一次
// 转换,任何破坏冷启动的过度剥皮(presets/extensions/未来任意必需目录)当场暴露、bundle 产不出。
// 若有人删了这道闸,过度剥皮就又能悄悄溜过去,故在 CI 层钉死闸的存在。
describe("冷启动 smoke gate 存在(防被删)", () => {
  test("prepare-lo-bundle.sh 含冷启动 smoke test(全新 profile 转换 + 失败 exit 1)", () => {
    expect(SH).toMatch(/-env:UserInstallation=/)
    expect(SH).toMatch(/--convert-to\s+pdf/)
    expect(SH).toMatch(/smoke\.pdf/)
    expect(SH).toMatch(/exit 1/) // 失败必须中止,不能产出残缺 bundle
  })

  test("prepare-lo-bundle.ps1 含冷启动 smoke test(全新 profile 转换 + 失败 throw)", () => {
    expect(PS1).toMatch(/-env:UserInstallation=/)
    expect(PS1).toMatch(/--convert-to.*pdf|"pdf"/)
    expect(PS1).toMatch(/smoke\.pdf|smoke\\\.pdf|out\\smoke/)
    expect(PS1).toMatch(/throw/) // 失败必须中止
  })
})

// 守护 build 侧完整性校验:注入前确认 bundle 含 presets + extensions(挡 fix 前的过期/过度剥皮 bundle)
describe("build-deskfox bundle 完整性校验存在(防过期 bundle 流入打包)", () => {
  const BUILD_SH = readFileSync(join(SCRIPTS, "build-deskfox.sh"), "utf8")
  const BUILD_PS1 = readFileSync(join(SCRIPTS, "build-deskfox.ps1"), "utf8")

  test("build-deskfox.sh 注入前校验 presets/extensions 存在", () => {
    expect(BUILD_SH).toMatch(/for\s+_req\s+in\s+presets\s+extensions/)
  })

  test("build-deskfox.ps1 注入前校验 presets/extensions 存在", () => {
    expect(BUILD_PS1).toMatch(/presets["\s,]/)
    expect(BUILD_PS1).toMatch(/share\/extensions/)
  })
})

// 守护"出货必须含 LO":缺 LO 时出货构建硬失败(不静默降级)+ 打包后验证最终包真含 soffice。
// 对应 3-tier:Tier1/2(发布物,出真包)缺 LO → 硬失败;Tier3(--no-bundle raw exe 自测)允许跳过。
describe("出货必须含 LibreOffice(缺 LO 不静默出货 + 打包后验证)", () => {
  const BUILD_SH = readFileSync(join(SCRIPTS, "build-deskfox.sh"), "utf8")
  const BUILD_PS1 = readFileSync(join(SCRIPTS, "build-deskfox.ps1"), "utf8")

  test("build-deskfox.sh:出货构建缺 LO 硬失败(--no-bundle 才放行,否则 exit 1)", () => {
    expect(BUILD_SH).toMatch(/elif\s+\[\[\s+"\$NO_BUNDLE"\s+-eq\s+1/) // Tier3 放行分支
    expect(BUILD_SH).toMatch(/发布物构建[\s\S]*?exit 1/) // 出货缺 LO → 硬失败
  })

  test("build-deskfox.ps1:出货构建缺 LO 硬失败(-NoBundle 才放行,否则 throw)", () => {
    expect(BUILD_PS1).toMatch(/elseif\s*\(\$NoBundle\)/) // Tier3 放行分支
    expect(BUILD_PS1).toMatch(/throw[\s\S]*?发布物构建/) // 出货缺 LO → throw
  })

  test("build-deskfox.sh:打包后验证最终 .app 内 soffice 存在(挡 LO 没注入)", () => {
    expect(BUILD_SH).toMatch(/VERIFY_SOFFICE/)
    expect(BUILD_SH).toMatch(/libreoffice\/Contents\/MacOS\/soffice/)
  })

  // [feat: win-lo-bundle-output-verify 2026-06-08] Win 侧对称的"输出验证":发布构建(非 -NoBundle)
  // 注入 LO 后,确认 Tauri 真把 LO 输出到 target/release/libreoffice/program/soffice.exe(填同事留的
  // Win follow-up;Mac 有 VERIFY_SOFFICE,Win 之前空)。防 --config deep-merge 静默失败致产物缺 LO。
  test("build-deskfox.ps1:全量 build 后验证 LO 已输出到 target/release/libreoffice/(挡 LO 没注入)", () => {
    expect(BUILD_PS1).toMatch(/target\/release\/libreoffice\/program\/soffice\.exe/)
    expect(BUILD_PS1).toMatch(/\$loConfigFile\s+-and\s+-not\s+\$NoBundle/) // 仅发布物验,Tier3 raw exe 豁免
  })
})

// 守护"发布闸"(权威):pack-installer 是 Tier1/2 发布唯一入口,缺 LO bundle 在 bump 前硬失败。
// 这是比 build-deskfox 的 --no-bundle 判据更可靠的"是否发布"判据(Windows 发布也用 -NoBundle,
// 那个判据在 Win 不可靠;走没走 pack-installer 才是真判据)。
describe("发布闸:pack-installer 缺 LO 硬失败(Tier1/2 发布物必须含 LibreOffice)", () => {
  const PACK_SH = readFileSync(join(SCRIPTS, "pack-installer.sh"), "utf8")
  const PACK_PS1 = readFileSync(join(SCRIPTS, "pack-installer.ps1"), "utf8")

  test("pack-installer.sh 缺 LO bundle → exit 1(且在 bump 前)", () => {
    expect(PACK_SH).toMatch(/必须含 LibreOffice/)
    expect(PACK_SH).toMatch(/LO_BUNDLE_APP[\s\S]*?exit 1/)
  })

  test("pack-installer.ps1 缺 LO bundle → throw", () => {
    expect(PACK_PS1).toMatch(/必须含 LibreOffice/)
    expect(PACK_PS1).toMatch(/loBundleWin/)
  })

  test("两端发布闸都校验 presets + extensions 完整", () => {
    expect(PACK_SH).toMatch(/for\s+_req\s+in\s+presets\s+extensions/)
    expect(PACK_PS1).toMatch(/presets["\s,]/)
    expect(PACK_PS1).toMatch(/share\/extensions/)
  })

  // [feat: win-lo-bundle-output-verify 2026-06-08] 末道产物大小哨兵:NSIS 安装包必含 LO(~190MB),
  // 完整包 >100MB,无 LO 包仅 ~15-25MB。低于阈值 → NSIS 漏打 LO,绝不发。也覆盖 -SkipBuild 路径
  // (跳过 build 直接校已存在的 NSIS 产物大小),填同事提到的"-SkipBuild 产物验证缺口"。
  test("pack-installer.ps1:NSIS 产物大小哨兵(<100MB = 不含 LO,throw)", () => {
    expect(PACK_PS1).toMatch(/minInstallerMB/)
    expect(PACK_PS1).toMatch(/产物不完整/)
  })
})
