#!/usr/bin/env bun

// [fork-only] DeskFox updater latest.json 生成器(单平台 per-target)
// [启用自动升级] 2026-06-05 重写为 per-platform
//
// 背景:updater endpoint 用 {{target}} 按平台分发(见 docs/governance/版本号与发布渠道规范.md §3.4),
//   每个平台拉各自 latest.json(版本号独立)。本脚本一次生成【一个平台】的 manifest,ship 时每平台调一次。
//
// Tauri updater 平台 key 格式 = <os>-<arch>(windows-x86_64 / darwin-aarch64 / linux-x86_64);
//   mac 额外补 darwin-aarch64-app 别名(对齐上游 .app.tar.gz 习惯)。
//
// 用法:
//   bun run packages/branding/scripts/finalize-latest-json.ts \
//     --target windows \
//     --version 2026.6.1 \
//     --url https://dl.clawtray.com/DeskFox-2026.6.1-setup.exe \
//     --sig packages/desktop/src-tauri/target/release/bundle/nsis/DeskFox_2026.6.1_x64-setup.exe.sig \
//     --pub-date 2026-06-05T00:00:00Z \
//     --out /tmp/windows
//   → 写 /tmp/windows/latest.json
//
// --pub-date 必传(脚本不调 Date,保证可复现);--notes 可选。

import { parseArgs } from "node:util"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    target: { type: "string" },        // windows | darwin | linux
    arch: { type: "string", default: "" }, // 留空则按 target 取默认 arch
    version: { type: "string" },
    url: { type: "string" },           // 安装包/更新产物的下载 URL(优先 OSS CDN)
    sig: { type: "string" },           // .sig 签名文件路径
    "pub-date": { type: "string" },
    notes: { type: "string", default: "" },
    out: { type: "string", default: "." },
  },
})

function req(name: string, v: string | undefined): string {
  if (!v) throw new Error(`--${name} is required`)
  return v
}

const target = req("target", values.target)
const version = req("version", values.version)
const url = req("url", values.url)
const sigPath = req("sig", values.sig)
const pubDate = req("pub-date", values["pub-date"])
const outDir = values.out as string

if (!["windows", "darwin", "linux"].includes(target)) {
  throw new Error(`--target must be one of windows|darwin|linux (got ${target})`)
}
if (!existsSync(sigPath)) throw new Error(`signature file not found: ${sigPath}`)
const signature = readFileSync(sigPath, "utf-8").trim()
if (!signature) throw new Error(`signature file is empty: ${sigPath}`)

// 默认 arch:DeskFox 当前 win=x86_64 / mac=aarch64 / linux=x86_64
const defaultArch: Record<string, string> = {
  windows: "x86_64",
  darwin: "aarch64",
  linux: "x86_64",
}
const arch = values.arch || defaultArch[target]

const entry = { url, signature }
const platforms: Record<string, { url: string; signature: string }> = {
  [`${target}-${arch}`]: entry,
}
// mac:补 -app 别名(上游 .app.tar.gz updater 习惯用 darwin-<arch>-app)
if (target === "darwin") {
  platforms[`darwin-${arch}-app`] = entry
}

const manifest = {
  version,
  notes: values.notes,
  pub_date: pubDate,
  platforms,
}

mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, "latest.json")
writeFileSync(outFile, JSON.stringify(manifest, null, 2))

console.log(`[finalize] wrote ${outFile}`)
console.log(`  target=${target} arch=${arch} version=${version}`)
console.log(`  platforms: ${Object.keys(platforms).join(", ")}`)
console.log(`  url: ${url}`)
console.log(`  部署到: updates.deskfox.ai:/var/www/updates/v1/latest/<channel>/${target}/latest.json`)
