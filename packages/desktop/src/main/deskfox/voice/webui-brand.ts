// [fork-only] REQ-102 语音 WebUI 品牌化 —— 资源安装与注入 [feat: voice-dispatch-minimal] 2026-08-22
//
// 目标(user 2026-08-22):语音界面要突出「DeskFox 小狐狸投研助手」,把「千问」「OpenCode」
// 这类第三方标识去掉。
//
// 为什么是这个做法:
//   · qwen 的 WebUI 是打包好的 React SPA,文案全在带 hash 的 JS bundle 里 —— 改 HTML 没用;
//   · 它**没有品牌定制入口**(自带 skin 机制只管悬浮球外观);
//   · 直接改 bundle 等于改 node_modules,升级即失,也违反 R3(品牌不 hardcode 进上游)。
// 所以:品牌资源放我们自己的 `packages/branding/voice-webui/`(进版本控制),
// 复制到 qwen 会静态服务的 `skins/` 目录(`gateway-application.mjs:428` 的
// `express.static(configDirectory/skins)`),再往它的 `index.html` 注入**两行**标签。
//
// ⚠️ 注入 `index.html` 确实动了 node_modules,这是本方案唯一的妥协。做了三件事兜住:
//   ① 幂等 —— 靠 marker 判断,重复启动不会重复插;
//   ② 每次起网关都跑 —— qwen 升级把 index.html 覆盖了,下次开语音自动补回;
//   ③ 只加两行、不改任何既有内容 —— 就算我们的文件没了,页面照常工作(只是没品牌)。

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

/** 注入标记:既是幂等判据,也让人一眼看出这两行是谁加的 */
export const BRAND_MARKER = "deskfox-voice-brand"

const ASSET_FILES = ["deskfox-brand.css", "deskfox-brand.js", "logo.png"] as const

/** 品牌资源在 fork 仓里的位置(源) */
export function brandSourceDir(repoRoot: string): string {
  return path.join(repoRoot, "packages", "branding", "voice-webui")
}

/** qwen 静态服务的 skins 目录(目标)。跟着 XDG 走 —— 语音进程的配置目录是 DeskFox 命名空间 */
export function brandSkinDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const configHome = env.XDG_CONFIG_HOME || path.join(home, ".config")
  return path.join(configHome, "qwaudio", "skins", "deskfox")
}

/**
 * 往 WebUI 的 index.html 插入品牌标签。**纯函数**,便于单测。
 *
 * 已经有 marker 就原样返回(幂等)。找不到 `</head>` 也原样返回 ——
 * 与其猜位置插错,不如不插:大不了这次没品牌,页面还是好的。
 */
export function injectBrandTags(html: string): string {
  const source = String(html ?? "")
  if (source.includes(BRAND_MARKER)) return source
  const closeHead = source.indexOf("</head>")
  if (closeHead < 0) return source
  const tags = [
    `    <!-- ${BRAND_MARKER}: DeskFox 品牌化,由 DeskFox 主进程在启动语音网关时注入(幂等) -->`,
    `    <link rel="stylesheet" href="/skins/deskfox/deskfox-brand.css" />`,
    `    <link rel="icon" href="/skins/deskfox/logo.png" />`,
    `    <script src="/skins/deskfox/deskfox-brand.js" defer></script>`,
    "",
  ].join("\n")
  return source.slice(0, closeHead) + tags + source.slice(closeHead)
}

/**
 * 从 `qwenaudio` 可执行文件反推 WebUI 入口。**向上搜索,不硬算层级**。
 *
 * 2026-08-22 连踩两次:先是没解引用 homebrew 的符号链接(往 `homebrew/web/dist` 找),
 * 解引用后又发现真实路径是 `.../qwen-audio-agent/cli/bin/qwenaudio.mjs` —— 比想象中深一层,
 * 硬写 `../web/dist` 就变成了 `cli/web/dist`。既然层级不可靠,就从入口往上逐级找,
 * 谁先有 `web/dist/index.html` 谁就是包根。找不到返回空串,调用方据此跳过品牌化。
 */
export function resolveWebuiIndex(
  qwenaudioRealPath: string,
  exists: (p: string) => boolean = existsSync,
): string {
  let dir = path.dirname(String(qwenaudioRealPath ?? ""))
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "web", "dist", "index.html")
    if (exists(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ""
}

export interface BrandResult {
  readonly installed: boolean
  readonly injected: boolean
  readonly note: string
}

/**
 * 装品牌资源 + 注入标签。**整体尽力而为**:任何一步失败都只记原因,
 * 绝不让品牌化挡住语音本身 —— 没品牌的界面也是能用的界面。
 */
export function applyWebuiBrand(input: {
  readonly repoRoot: string
  readonly webuiIndexPath: string
  readonly env?: NodeJS.ProcessEnv
  readonly home?: string
}): BrandResult {
  const env = input.env ?? process.env
  // 逃生开关:品牌化是"锦上添花",一旦它把界面搞坏(2026-08-22 就出过自激卡死),
  // 用户必须能一键退回原版而不是干等修复。off 时连资源都不装。
  const off = String(env.DESKFOX_VOICE_BRAND ?? "").trim().toLowerCase()
  if (off === "off" || off === "0" || off === "false") {
    return { installed: false, injected: false, note: "已按 DESKFOX_VOICE_BRAND 关闭品牌化" }
  }
  const home = input.home ?? homedir()
  const src = brandSourceDir(input.repoRoot)
  const dst = brandSkinDir(env, home)

  let installed = false
  try {
    mkdirSync(dst, { recursive: true })
    for (const name of ASSET_FILES) {
      const from = path.join(src, name)
      if (!existsSync(from)) return { installed: false, injected: false, note: `品牌资源缺失:${from}` }
      copyFileSync(from, path.join(dst, name))
    }
    installed = true
  } catch (e) {
    return { installed: false, injected: false, note: `复制品牌资源失败:${String(e)}` }
  }

  try {
    if (!existsSync(input.webuiIndexPath)) {
      return { installed, injected: false, note: `找不到 WebUI 入口:${input.webuiIndexPath}` }
    }
    const html = readFileSync(input.webuiIndexPath, "utf8")
    const next = injectBrandTags(html)
    if (next === html) return { installed, injected: false, note: "品牌标签已在,无需重复注入" }
    writeFileSync(input.webuiIndexPath, next)
    return { installed, injected: true, note: "已注入品牌标签" }
  } catch (e) {
    return { installed, injected: false, note: `注入品牌标签失败:${String(e)}` }
  }
}
