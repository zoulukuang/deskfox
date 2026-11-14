// [fork-only] REQ-102 语音 WebUI 品牌化单测 [feat: voice-dispatch-minimal] 2026-08-22
// 注入 index.html 是本方案唯一动 node_modules 的地方,幂等性必须钉死 —— 每次起网关都会跑一遍。
import { describe, expect, test } from "bun:test"
import {
  applyWebuiBrand,
  BRAND_MARKER,
  brandSkinDir,
  brandSourceDir,
  injectBrandTags,
  resolveWebuiIndex,
} from "./webui-brand"

// qwen-audio-agent 1.11.0 的真实 index.html(web/dist/index.html)
const REAL_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>qwen-audio-agent</title>
    <script type="module" crossorigin src="./assets/index-D09JtNnt.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-ilmoXqWV.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`

describe("injectBrandTags", () => {
  test("插在 </head> 之前,且原内容一字不动", () => {
    const out = injectBrandTags(REAL_HTML)
    expect(out).toContain(BRAND_MARKER)
    expect(out.indexOf("deskfox-brand.js")).toBeLessThan(out.indexOf("</head>"))
    // 原来的 bundle 引用必须还在 —— 动了它页面就废了
    expect(out).toContain("./assets/index-D09JtNnt.js")
    expect(out).toContain("./assets/index-ilmoXqWV.css")
  })

  // 每次起网关都会调,不幂等就会插成一堆
  test("幂等:已经注入过就原样返回", () => {
    const once = injectBrandTags(REAL_HTML)
    expect(injectBrandTags(once)).toBe(once)
    expect(injectBrandTags(injectBrandTags(once))).toBe(once)
  })

  test("三样都插:样式 / favicon / 脚本", () => {
    const out = injectBrandTags(REAL_HTML)
    expect(out).toContain("/skins/deskfox/deskfox-brand.css")
    expect(out).toContain("/skins/deskfox/logo.png")
    expect(out).toContain("/skins/deskfox/deskfox-brand.js")
  })

  // 与其猜位置插错,不如不插 —— 大不了这次没品牌,页面还是好的
  test("没有 </head> / 空输入 → 原样返回,不瞎插", () => {
    expect(injectBrandTags("<html><body>x</body></html>")).toBe("<html><body>x</body></html>")
    expect(injectBrandTags("")).toBe("")
  })
})

// 品牌化是锦上添花,一旦它把界面搞坏(2026-08-22 的自激卡死),用户必须能一键退回原版
describe("逃生开关", () => {
  test("DESKFOX_VOICE_BRAND=off → 连资源都不装", () => {
    for (const value of ["off", "0", "false", "OFF"]) {
      const r = applyWebuiBrand({
        repoRoot: "/repo",
        webuiIndexPath: "/nope/index.html",
        env: { DESKFOX_VOICE_BRAND: value } as NodeJS.ProcessEnv,
        home: "/h",
      })
      expect(r.installed).toBe(false)
      expect(r.injected).toBe(false)
      expect(r.note).toContain("关闭")
    }
  })
})

describe("路径推导", () => {
  // 本机真实布局:.../qwen-audio-agent/cli/bin/qwenaudio.mjs,而 WebUI 在 .../qwen-audio-agent/web/dist
  const PKG = "/opt/homebrew/lib/node_modules/qwen-audio-agent"
  const has = (p: string) => p === `${PKG}/web/dist/index.html`

  test("向上搜索找到包根 —— 入口埋在 cli/bin 下也能找到", () => {
    expect(resolveWebuiIndex(`${PKG}/cli/bin/qwenaudio.mjs`, has)).toBe(`${PKG}/web/dist/index.html`)
  })

  test("入口直接在 bin/ 下同样找得到(布局变了也不用改代码)", () => {
    expect(resolveWebuiIndex(`${PKG}/bin/qwenaudio`, has)).toBe(`${PKG}/web/dist/index.html`)
  })

  // 2026-08-22 连踩两次:先是没解引用 homebrew 符号链接(往 homebrew/web/dist 找)、
  // 解引用后又硬算层级算成了 cli/web/dist。所以改成向上搜索 + 找不到就返回空串。
  test("找不到 → 空串,调用方据此跳过品牌化,而不是拿错路径去写文件", () => {
    expect(resolveWebuiIndex("/Users/x/homebrew/bin/qwenaudio", () => false)).toBe("")
    expect(resolveWebuiIndex("", () => false)).toBe("")
  })

  // skins 目录跟着 XDG 走 —— 语音进程的配置目录是 DeskFox 命名空间,不是系统默认
  test("skin 目录跟随 XDG_CONFIG_HOME", () => {
    expect(brandSkinDir({ XDG_CONFIG_HOME: "/h/.config/deskfox" }, "/h")).toBe(
      "/h/.config/deskfox/qwaudio/skins/deskfox",
    )
    expect(brandSkinDir({}, "/h")).toBe("/h/.config/qwaudio/skins/deskfox")
  })

  test("品牌资源取自 fork 仓,不是 node_modules", () => {
    expect(brandSourceDir("/repo")).toBe("/repo/packages/branding/voice-webui")
  })
})
