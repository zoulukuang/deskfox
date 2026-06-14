import { $ } from "bun"
import { cpSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const src = `./icons/${channel}`
const dest = "resources/icons"

await $`rm -rf ${dest}`
await $`cp -R ${src} ${dest}`
console.log(`Copied ${channel} icons from ${src} to ${dest}`)

// FORK-BEGIN: 用 DeskFox branding 图标覆盖上游 □ 图标。运行时窗口/任务栏(Win 用 icon.ico)/Dock
// 都从 resources/icons 读(见 desktop/src/main/windows.ts iconPath()/setDockIcon()),上游 copy 进来的是
// □ 占位 → 覆盖。仅覆盖 branding 顶层提供的文件(icon.ico / *.png),其余(icns/dock/Square 等 branding
// 暂未出的)沿用上游集占位;跳过 ico-source/ 等子目录(png-to-ico 源,不进发布物)。
// [feat: electron-brand-cleanup]
const brandingIcons = join("..", "branding", "src", "assets", "icons", channel)
if (existsSync(brandingIcons)) {
  let overlaid = 0
  for (const name of readdirSync(brandingIcons)) {
    const from = join(brandingIcons, name)
    if (statSync(from).isDirectory()) continue
    cpSync(from, join(dest, name))
    overlaid++
  }
  console.log(`Overlaid ${overlaid} DeskFox branding icon file(s) from ${brandingIcons}`)
} else {
  console.warn(`[deskfox] branding icons not found, keeping upstream icons: ${brandingIcons}`)
}
// FORK-END
