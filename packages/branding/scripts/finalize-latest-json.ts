#!/usr/bin/env bun

// [fork-only] DeskFox updater latest.json finalizer
// [启用自动升级] 2026-06-05
//
// 从构建产物目录收集各平台 NSIS .exe / .app.tar.gz + 对应 .sig 签名文件,
// 组装 Tauri updater 要求的 latest.json 格式并写入输出目录。
//
// 与上游 finalize-latest-json.ts 的区别:
//   1. 不从 GitHub Release API 获取 assets,直接从本地构建目录读取
//   2. url 字段优先指向 OSS CDN(dl.clawtray.com),GitHub 作为 fallback
//   3. 适配 DeskFox NSIS 命名(不再走 Inno 的自定义 OutputBaseFilename)
//
// 用法:
//   bun run packages/branding/scripts/finalize-latest-json.ts \
//     --version 2026.6.5.1 \
//     --env prod \
//     --build-dir packages/desktop/src-tauri/target/release/bundle \
//     --cdn-base https://dl.clawtray.com/desktop \
//     --gh-base https://github.com/zoulukuang/deskfox/releases/download \
//     --output-dir /tmp

import { parseArgs } from "node:util"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, basename } from "node:path"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    version: { type: "string" },
    env: { type: "string", default: "prod" },
    buildDir: { type: "string" },
    cdnBase: { type: "string", default: "https://dl.clawtray.com/desktop" },
    ghBase: { type: "string", default: "https://github.com/zoulukuang/deskfox/releases/download" },
    outputDir: { type: "string", default: "/tmp" },
    "dry-run": { type: "boolean", default: false },
  },
})

const version = values.version
if (!version) throw new Error("--version is required")

const env = values.env as string
const buildDir = values.buildDir
if (!buildDir) throw new Error("--buildDir is required")

const cdnBase = values.cdnBase
const ghBase = values.ghBase
const outputDir = values.outputDir
const dryRun = values["dry-run"]

const envTag = env === "prod" ? "" : env === "beta" ? "-beta" : "-dev"
const versionTag = `v${version}${envTag}`

const productName = env === "prod" ? "DeskFox" : env === "beta" ? "DeskFox Beta" : "DeskFox Dev"

type PlatformEntry = {
  url: string
  signature: string
}

const platforms: Record<string, PlatformEntry> = {}

function addPlatform(
  key: string,
  assetName: string,
  signatureContent: string,
  preferCdn: boolean,
) {
  if (platforms[key]) return
  const ghUrl = `${ghBase}/${versionTag}/${assetName}`
  const cdnUrl = `${cdnBase}/${versionTag}/${assetName}`
  platforms[key] = {
    url: preferCdn ? cdnUrl : ghUrl,
    signature: signatureContent,
  }
}

function readSignatureFile(sigPath: string): string | null {
  if (!existsSync(sigPath)) return null
  return readFileSync(sigPath, "utf-8").trim()
}

// macOS targets
const macBundleDir = join(buildDir, "macos")
const dmgDir = join(buildDir, "dmg")

// .app.tar.gz + .sig (Tauri updater format for macOS)
// Tauri naming: <ProductName>_x64.app.tar.gz / <ProductName>_aarch64.app.tar.gz
// When createUpdaterArtifacts is true, Tauri generates .app.tar.gz + .app.tar.gz.sig
const macTargets = [
  { key: "darwin-aarch64-app", arch: "aarch64" },
  { key: "darwin-x86_64-app", arch: "x64" },
]

for (const target of macTargets) {
  const archSuffix = target.arch === "aarch64" ? "_aarch64" : "_x64"
  const appTarGz = join(macBundleDir, `${productName}${archSuffix}.app.tar.gz`)
  const sigPath = appTarGz + ".sig"

  if (!existsSync(appTarGz)) continue

  const sig = readSignatureFile(sigPath)
  if (!sig) continue

  addPlatform(target.key, basename(appTarGz), sig, true)
}

// Windows NSIS targets
// Tauri naming: <ProductName>_x64-setup.exe / <ProductName>_x64-setup.exe.sig
const nsisDir = join(buildDir, "nsis")
const nsisSuffix = "_x64-setup.exe"

const winTargets = [
  { key: "windows-x86_64-nsis", suffix: "_x64-setup.exe" },
]

for (const target of winTargets) {
  const exeName = `${productName}${target.suffix}`
  const exePath = join(nsisDir, exeName)
  const sigPath = exePath + ".sig"

  if (!existsSync(exePath)) continue

  const sig = readSignatureFile(sigPath)
  if (!sig) continue

  addPlatform(target.key, exeName, sig, true)
}

// Linux targets (deb + AppImage)
// For future use — currently DeskFox doesn't ship Linux desktop
const debDir = join(buildDir, "deb")
const linuxTargets = [
  { key: "linux-x86_64-deb", pattern: `${productName}_*_amd64.deb` },
]

// Skip Linux for now — not in scope

// Alias entries (Tauri updater uses short keys as fallback)
function alias(key: string, source: string) {
  if (platforms[key]) return
  const entry = platforms[source]
  if (!entry) return
  platforms[key] = { ...entry }
}

alias("darwin-aarch64", "darwin-aarch64-app")
alias("darwin-x86_64", "darwin-x86_64-app")
alias("windows-x86_64", "windows-x86_64-nsis")

const sortedPlatforms = Object.fromEntries(
  Object.keys(platforms)
    .sort()
    .map((key) => [key, platforms[key]]),
)

const output = {
  version: version,
  date: new Date().toISOString(),
  platforms: sortedPlatforms,
}

const outputFile = join(outputDir, "latest.json")
mkdirSync(outputDir, { recursive: true })
writeFileSync(outputFile, JSON.stringify(output, null, 2))

console.log(`finalized latest.json for ${versionTag}`)
console.log(`  platforms: ${Object.keys(sortedPlatforms).join(", ") || "(none — no signed artifacts found)"}`)
console.log(`  output: ${outputFile}`)

if (dryRun) {
  console.log("dry-run: file written but not uploaded")
} else {
  console.log("next steps:")
  console.log("  1. Upload installer assets to OSS CDN")
  console.log("  2. Upload latest.json to GitHub Release")
  console.log("  3. SCP latest.json to updates.deskfox.ai:/var/www/updates/desktop/")
}