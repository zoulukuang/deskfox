// FORK-ONLY: DeskFox electron-builder 三档配置 [feat: electron-replatform] 2026-06-13
//
// R3 治理:品牌不改上游 electron-builder.config.ts,走本独立配置(--config 指定)。
// 身份对齐 main/index.ts APP_IDS(ai.deskfox.app 三档,继承 Tauri 版,升级无感)。
// 用法:OPENCODE_CHANNEL=dev|beta|prod bunx electron-builder --win --config electron-builder.deskfox.config.ts
// 前置:packages/branding/scripts 先生成 icon.ico(apply-icons 流程;icon.ico gitignored 现场生成)。

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Configuration } from "electron-builder"

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const brandingDir = path.resolve(packageDir, "../branding")
const mediaGenDir = path.resolve(packageDir, "../media-gen")

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

// FORK: 版本号按 channel × platform 独立号线注入(规范 §3.2bis Dev 领先模式)。
// 换基座漏迁 build-deskfox.ps1 的版本注入逻辑 → electron-builder 默认用了 package.json 的上游 semver
// (1.17.4),与 DeskFox 日历号 YYYY.次.补 + updater 比较脱节。此处补回:从 installer-versions.json
// 按目标平台 + channel 读独立号线(prod 读裸 <plat>;dev/beta 读 dev-<plat>/beta-<plat>),覆盖 version。
const targetPlat = (() => {
  const argv = process.argv.join(" ")
  if (argv.includes("--mac")) return "macos"
  if (argv.includes("--win")) return "windows"
  if (argv.includes("--linux")) return "linux"
  // 无显式 --mac/--win/--linux flag 时,electron-builder 默认构建本机平台 → 按 process.platform 回落,
  // 避免在 Mac 上漏传 --mac 时错读 windows 号线(静默出错版本号)。
  if (process.platform === "darwin") return "macos"
  if (process.platform === "linux") return "linux"
  return "windows"
})()
const appVersion = (() => {
  const versions = JSON.parse(
    fs.readFileSync(path.join(brandingDir, "installer-versions.json"), "utf8"),
  ) as Record<string, string>
  const verKey = channel === "prod" ? targetPlat : `${channel}-${targetPlat}`
  const v = versions[verKey] ?? versions[targetPlat]
  if (!v) throw new Error(`[deskfox] installer-versions.json missing version (key=${verKey})`)
  return v
})()

const APP_IDS = {
  dev: "ai.deskfox.app.dev",
  beta: "ai.deskfox.app.beta",
  prod: "ai.deskfox.app",
} as const
const PRODUCT_NAMES = { dev: "DeskFox Dev", beta: "DeskFox Beta", prod: "DeskFox" } as const
const ARTIFACT_PREFIX = { dev: "DeskFox-Dev", beta: "DeskFox-Beta", prod: "DeskFox" } as const
// 图标:dev/beta 用 dev 套(预览狐),prod 用 prod 套
const iconEnv = channel === "prod" ? "prod" : "dev"
const iconIco = path.join(brandingDir, "src", "assets", "icons", iconEnv, "icon.ico")

// FORK: 删除上游 native/(mac_window.node + swift-build)extraResources 条目 —— 该 native 模块在 fork
// 两分支均无源码、src/main 零 import,electron-builder 每次构建报 "file source doesn't exist from=.../native"
// warning。功能未接,YAGNI 移除;后续若接 mac 原生窗口能力再补回。[feat: electron-replatform-macos]
const extraResources: Array<{ from: string; to: string; filter?: string[] }> = [
  // DeskFox 插件(Node 版 dist;装机后由 main/deskfox/plugin-install.ts 注入+自愈)。
  // dist/plugin.js 是 gitignored 现场产物 → build 脚本打包前断言其存在,防 extraResources 拷空。
  { from: path.join(brandingDir, "plugin", "feishu-bridge"), to: "plugin/feishu-bridge", filter: ["dist/**", "package.json"] },
  { from: mediaGenDir, to: "plugin/media-gen", filter: ["dist/**"] },
]

// FORK: 注入内置 LibreOffice bundle(office 预览/转换依赖),按平台结构 + 后端探测路径区分落点:
//   - macOS:   libreoffice-bundle/macos/LibreOffice.app → extraResources → Contents/Resources/libreoffice;
//              对齐后端 office-installer.ts:dirname(execPath)/../Resources/libreoffice/Contents/MacOS/soffice。
//   - Windows: libreoffice-bundle/windows(program/soffice.exe 结构)→ extraFiles → app 根 {app}\libreoffice
//              (与 DeskFox.exe 同级,非 resources/ 下);对齐后端**现有**路径
//              dirname(execPath)\libreoffice\program\soffice.exe → 后端零改动(R1 三级跳:配置层适配,不动黑名单
//              office-installer.ts;与 Tauri 旧布局一致)。extraFiles 落 app 根、extraResources 落 resources/,这是两端
//              结构差异(mac .app 必须进 Contents/Resources,Win 无此约束)。
// 两端均"仅在 bundle 存在时注入" —— 否则 electron-builder 报 "file source doesn't exist" 中断本地无 LO 的自测构建;
// "发布物必须含健康 LO"的硬门槛由 build-deskfox-electron.{sh,ps1} 把守(对齐 main build-deskfox §1.9 分层)。
// [feat: electron-replatform-macos / electron-replatform-windows] 2026-06-14
const extraFiles: Array<{ from: string; to: string; filter?: string[] }> = []
if (targetPlat === "macos") {
  const loApp = path.join(brandingDir, "libreoffice-bundle", "macos", "LibreOffice.app")
  if (fs.existsSync(loApp)) {
    extraResources.push({ from: loApp, to: "libreoffice" })
  }
} else if (targetPlat === "windows") {
  const loWin = path.join(brandingDir, "libreoffice-bundle", "windows")
  // soffice.exe 存在性为准(目录可能残留空壳),命中才注入到 app 根 libreoffice/。
  if (fs.existsSync(path.join(loWin, "program", "soffice.exe"))) {
    extraFiles.push({ from: loWin, to: "libreoffice" })
  }
}

const config: Configuration = {
  appId: APP_IDS[channel],
  productName: PRODUCT_NAMES[channel],
  // 安装目录独立(默认取 package.json name "@opencode-ai/desktop" → 与上游官方版同目录互踩,实测踩坑)
  extraMetadata: {
    name: channel === "prod" ? "deskfox" : `deskfox-${channel}`,
    // FORK: 覆盖 version 为 DeskFox 日历号(否则用 package.json 上游 semver 1.17.4,见上 appVersion 注释)
    version: appVersion,
    // FORK: 覆盖 author.name —— NSIS 卸载列表「发布者」取 metadata.author.name(见 app-builder-lib
    // appInfo.companyName → installer.nsh 写 Publisher),package.json 原为 "OpenCode";改为 DeskFox。
    // 发布者=厂商,三档统一「DeskFox」(不带 Dev/Beta —— 渠道由「名称」列的 productName 区分,发布者不重复)。
    // (win.publisherName 仅用于代码签名校验,且本 electron-builder JSON schema 对未签名构建拒绝该字段。)D1
    // [feat: electron-brand-cleanup]
    author: { name: "DeskFox", email: "hello@deskfox.ai" },
  },
  artifactName: `${ARTIFACT_PREFIX[channel]}-\${version}-\${os}-\${arch}.\${ext}`,
  directories: {
    output: "dist-deskfox",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources,
  // FORK: Windows LO bundle 注入到 app 根(与 exe 同级),对齐后端现有探测路径;mac 为空。[feat: electron-replatform-windows]
  extraFiles,
  protocols: {
    name: "DeskFox",
    schemes: ["opencode"], // 深链 scheme 沿用上游 contract(R3:binary 标识不改)
  },
  win: {
    icon: iconIco,
    target: ["nsis"],
    verifyUpdateCodeSignature: false, // DeskFox installer 不签名(治理:数字签名问题.md)
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: iconIco,
    installerHeaderIcon: iconIco,
    deleteAppDataOnUninstall: false, // 卸载保留 AppData(.dat/偏好),与 Tauri NSIS 行为一致
  },
  mac: {
    category: "public.app-category.productivity",
    icon: path.join(brandingDir, "src", "assets", "icons", iconEnv, "icon.icns"),
    target: ["dmg", "zip"],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    // 跳过嵌套 LibreOffice:osx-sign 逐文件签搞不定 LO 的多可执行结构(soffice 主可执行需兄弟 uno 先签,
    // 顺序无保证 → "subcomponent not signed" 失败)。改由 build 脚本 codesign --deep 预签 LO(正确处理顺序),
    // electron-builder 在此跳过它、只签外壳+后端,最后外层 seal 覆盖已签好的 LO。详见 docs/features/electron-macos-sign-notarize/。
    signIgnore: ["Resources/libreoffice"],
    // 签名/公证 env 驱动(密钥不入开源仓,见 docs/features/electron-macos-sign-notarize/):
    //   source ~/.deskfox-signing/config.env → 设 APPLE_SIGNING_IDENTITY → 自动 Developer ID 深签(含嵌套 LO/soffice)。
    //   DESKFOX_NOTARIZE=1 才公证(慢 5-15min);都不设 → identity:null 未签名快速本地包(阶段0 行为不变)。
    // electron-builder 要的是不带 "Developer ID Application:" 前缀的证书名(它自动选证书);
    // 而 config.env 的 APPLE_SIGNING_IDENTITY 是 Tauri 要的全名 → 这里剥前缀喂给 electron-builder。
    identity: (process.env.APPLE_SIGNING_IDENTITY ?? "").replace(/^Developer ID Application:\s*/i, "").trim() || null,
    notarize: process.env.DESKFOX_NOTARIZE === "1",
  },
  dmg: {
    sign: Boolean(process.env.APPLE_SIGNING_IDENTITY),
  },
  // 自动更新:electron-updater generic provider(latest.yml 部署到 updates.deskfox.ai,ship 时落地)
  publish: {
    provider: "generic",
    url: `https://updates.deskfox.ai/electron/${channel}`,
  },
}

export default config
