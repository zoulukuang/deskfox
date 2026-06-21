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

// 守护 build 侧完整性校验:注入前确认 LO bundle 含非空 presets(挡过期/过度剥皮 bundle 流入打包)。
// 换基座(Tauri→Electron 2026-06-15)后,守护对象从已删的 build-deskfox.{sh,ps1}/pack-installer.{sh,ps1}
// 迁到 build-deskfox-electron.{sh,ps1}(注入前硬卡 + post-build 复验)+ smoke/verify.ts(L3 发布物校验)。
// 注:electron 链精化了判据 —— presets 是 office 转换硬依赖(硬卡),extensions 打包必丢空目录(仅警告,不硬卡)。
describe("build-deskfox-electron 注入前 LO 完整性校验(防过期 bundle 流入打包)", () => {
  const BUILD_SH = readFileSync(join(SCRIPTS, "build-deskfox-electron.sh"), "utf8")
  const BUILD_PS1 = readFileSync(join(SCRIPTS, "build-deskfox-electron.ps1"), "utf8")

  test("build-deskfox-electron.sh:注入前 presets 非空硬卡(office 转换硬依赖)", () => {
    expect(BUILD_SH).toMatch(/presets/)
    expect(BUILD_SH).toMatch(/office 转换硬依赖/)
  })

  test("build-deskfox-electron.ps1:注入前 presets 非空硬卡(office 转换硬依赖)", () => {
    expect(BUILD_PS1).toMatch(/presets/)
    expect(BUILD_PS1).toMatch(/office 转换硬依赖/)
  })
})

// 守护"出货必须含 LO":发布物(非 --no-bundle/-NoBundle)缺 LO 时构建硬失败(不静默降级)+ post-build 验证最终包真含 soffice + 非空 presets。
// 对应 3-tier:Tier1/2(发布物,出真包)缺 LO → 硬失败;Tier3(--no-bundle / local raw 自测)允许跳过。
describe("出货必须含 LibreOffice(缺 LO 不静默出货 + post-build 验证)", () => {
  const BUILD_SH = readFileSync(join(SCRIPTS, "build-deskfox-electron.sh"), "utf8")
  const BUILD_PS1 = readFileSync(join(SCRIPTS, "build-deskfox-electron.ps1"), "utf8")

  test("build-deskfox-electron.sh:发布物缺 LO 硬失败(--no-bundle 才放行,否则 exit 1)", () => {
    expect(BUILD_SH).toMatch(/NO_BUNDLE/) // Tier3 放行判据
    expect(BUILD_SH).toMatch(/发布物构建但 LO bundle 不存在[\s\S]*?exit 1/) // 缺 LO → 硬失败
  })

  test("build-deskfox-electron.ps1:发布物缺 LO 硬失败(-NoBundle 才放行,否则 throw)", () => {
    expect(BUILD_PS1).toMatch(/NoBundle/) // Tier3 放行判据
    expect(BUILD_PS1).toMatch(/发布物构建但 LO bundle 不存在/) // 缺 LO → throw
  })

  test("build-deskfox-electron.sh:post-build 验证最终 .app 含可执行 soffice + 非空 presets(挡 LO 没注入)", () => {
    expect(BUILD_SH).toMatch(/VERIFY_SOFFICE/)
    expect(BUILD_SH).toMatch(/Contents\/MacOS\/soffice/)
    expect(BUILD_SH).toMatch(/最终 \.app 内 LO presets 缺失/)
  })

  test("build-deskfox-electron.ps1:post-build 验证最终包含 soffice.exe + 非空 presets(挡 LO 没注入)", () => {
    expect(BUILD_PS1).toMatch(/program\/soffice\.exe/)
    expect(BUILD_PS1).toMatch(/最终包内 LO presets 缺失/)
  })
})

// 守护"发布物 L3 校验"(权威):verify.ts 是 electron-updater 口径的发布物唯一校验入口(--release/--build),
// 取代旧 pack-installer 的"NSIS 大小哨兵"。换基座后"是否含 LO"判据 = 最终包内 soffice.exe 存在 +
// 升级链命门 latest.yml sha512 == exe 实算(不一致则客户端下载后校验失败装不上)。
describe("发布物 L3 校验:verify.ts 确认发布包真含 LibreOffice + 升级链完整", () => {
  const VERIFY = readFileSync(join(SCRIPTS, "..", "smoke", "verify.ts"), "utf8")

  test("verify.ts 校验发布包含 LO(win-unpacked/libreoffice/program/soffice.exe)", () => {
    expect(VERIFY).toMatch(/libreoffice[\s\S]*program[\s\S]*soffice\.exe/)
  })

  test("verify.ts 校验 latest.yml sha512 == exe(electron-updater 升级链命门)", () => {
    expect(VERIFY).toMatch(/sha512/)
  })
})
