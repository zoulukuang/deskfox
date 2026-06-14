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

const config: Configuration = {
  appId: APP_IDS[channel],
  productName: PRODUCT_NAMES[channel],
  // 安装目录独立(默认取 package.json name "@opencode-ai/desktop" → 与上游官方版同目录互踩,实测踩坑)
  extraMetadata: {
    name: channel === "prod" ? "deskfox" : `deskfox-${channel}`,
    // FORK: 覆盖 version 为 DeskFox 日历号(否则用 package.json 上游 semver 1.17.4,见上 appVersion 注释)
    version: appVersion,
  },
  artifactName: `${ARTIFACT_PREFIX[channel]}-\${version}-\${os}-\${arch}.\${ext}`,
  directories: {
    output: "dist-deskfox",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [
    // FORK: 删除上游 native/(mac_window.node + swift-build)extraResources 条目 —— 该 native 模块
    // 在 fork 两分支均无源码、src/main 零 import,electron-builder 每次构建报 "file source doesn't
    // exist from=.../native" warning。功能未接,YAGNI 移除以消除噪声;后续若接 mac 原生窗口能力再补回。
    // [feat: electron-replatform-macos] 2026-06-14
    // DeskFox 插件(Node 版 dist;装机后由 main/deskfox/plugin-install.ts 注入+自愈)
    { from: path.join(brandingDir, "plugin", "feishu-bridge"), to: "plugin/feishu-bridge", filter: ["dist/**", "package.json"] },
    { from: mediaGenDir, to: "plugin/media-gen", filter: ["dist/**"] },
  ],
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
    // 不签名/不公证(本地分发;ship 流程另定)
    identity: null,
  },
  // 自动更新:electron-updater generic provider(latest.yml 部署到 updates.deskfox.ai,ship 时落地)
  publish: {
    provider: "generic",
    url: `https://updates.deskfox.ai/electron/${channel}`,
  },
}

export default config
