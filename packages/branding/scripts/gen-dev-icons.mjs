// [fork-only] 从 logo.tsx 的矢量定义重新生成 dev 档图标全尺寸位图
// [feat: dev-channel-icon-lowres] 2026-08-18
//
// 起因:dev 档(local 也共用它,见 electron-builder.deskfox.config.ts 的
// `iconEnv = channel === "prod" ? "prod" : "dev"`)的 icon.icns 只有 8.5KB / 封顶 128×128,
// 而 prod 是 138KB / 1024×1024;`128x128@2x.png` 更是只有 128px 宽(按命名应为 256),
// 等于 @2x 资源是假的。后果:Retina 屏上预览版/本地版图标被放大拉糊。
//
// 修法不是"把 256 放大"(那只会糊得更均匀),而是回到**矢量源**:
// `packages/branding/src/logo.tsx` 的 MarkFavicon 就是 dev 档那个「极简 5 元素」变体,
// viewBox 64×64 纯路径,可无损渲染到任意尺寸。
//
// 用法:node packages/branding/scripts/gen-dev-icons.mjs
// 依赖:仓内已有的 playwright(chromium)做栅格化,不引入新依赖。
import { mkdir, writeFile, rm } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
// @playwright/test 装在 packages/app(e2e 用,它同样导出 chromium),branding 不额外加依赖 —— 显式从那儿解析。
const { chromium } = createRequire(join(HERE, "..", "..", "app", "package.json"))("@playwright/test")
const ICONS = join(HERE, "..", "src", "assets", "icons", "dev")

// verbatim 取自 packages/branding/src/logo.tsx 的 MarkFavicon(dev 档 branded 变体)。
// ⚠️ 改 logo.tsx 的 MarkFavicon 后需重跑本脚本,否则图标与应用内 logo 会不一致。
const SVG = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" width="SIZE" height="SIZE">
  <rect width="64" height="64" rx="14" fill="#1F2D44"/>
  <g transform="translate(32, 34)">
    <path d="M -19,-3 L -10,-21 L -5,-3 Z" fill="#7295C4"/>
    <path d="M 19,-3 L 10,-21 L 5,-3 Z" fill="#7295C4"/>
    <path d="M -19,-3 L 19,-3 L 0,18 Z" fill="#9DBBE3"/>
    <circle cx="-7" cy="3" r="2" fill="#172238"/>
    <circle cx="7" cy="3" r="2" fill="#172238"/>
  </g>
</svg>`

// icns 需要的完整尺寸集(对齐 prod 的层级);ico/PNG 复用其中若干
const SIZES = [16, 32, 64, 128, 256, 512, 1024]

async function render(page, size) {
  const svg = SVG.replaceAll("SIZE", String(size))
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:0;background:transparent">${svg}</body></html>`,
  )
  return page.screenshot({ omitBackground: true, type: "png" })
}

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })

const iconset = join(HERE, "..", ".tmp-dev.iconset")
await rm(iconset, { recursive: true, force: true })
await mkdir(iconset, { recursive: true })

const out = {}
for (const size of SIZES) {
  out[size] = await render(page, size)
  console.log(`rendered ${size}x${size}  (${out[size].length} bytes)`)
}
await browser.close()

// 1) iconset → icns(macOS 要求的命名;@2x 用两倍尺寸的位图)
const ICONSET_MAP = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
]
for (const [name, size] of ICONSET_MAP) await writeFile(join(iconset, name), out[size])
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(ICONS, "icon.icns")])
await rm(iconset, { recursive: true, force: true })

// 2) electron-builder 直接读的散图(注意 128x128@2x 必须是 **256px**,原来错成了 128)
await writeFile(join(ICONS, "32x32.png"), out[32])
await writeFile(join(ICONS, "128x128.png"), out[128])
await writeFile(join(ICONS, "128x128@2x.png"), out[256])

// 3) ico-source 补齐到 1024(与 prod 对齐),apply-icons 的 ico 流程从这里取
for (const size of SIZES) await writeFile(join(ICONS, "ico-source", `${size}.png`), out[size])

console.log("done → " + ICONS)
