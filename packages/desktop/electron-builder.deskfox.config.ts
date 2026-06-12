// FORK-ONLY: DeskFox electron-builder 三档配置 [feat: electron-replatform] 2026-06-13
//
// R3 治理:品牌不改上游 electron-builder.config.ts,走本独立配置(--config 指定)。
// 身份对齐 main/index.ts APP_IDS(ai.deskfox.app 三档,继承 Tauri 版,升级无感)。
// 用法:OPENCODE_CHANNEL=dev|beta|prod bunx electron-builder --win --config electron-builder.deskfox.config.ts
// 前置:packages/branding/scripts 先生成 icon.ico(apply-icons 流程;icon.ico gitignored 现场生成)。

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
  },
  artifactName: `${ARTIFACT_PREFIX[channel]}-\${version}-\${os}-\${arch}.\${ext}`,
  directories: {
    output: "dist-deskfox",
    buildResources: "resources",
  },
  files: ["out/**/*", "resources/**/*"],
  extraResources: [
    // 上游 native(mac window 等)
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
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
