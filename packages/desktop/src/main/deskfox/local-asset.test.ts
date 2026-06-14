// [fork-only] local-asset contextmenu 桥注入单测 — 从 Tauri local_asset.rs #[cfg(test)] 平移。
// 防回归:HTML 预览内右键"加入聊天"依赖此注入(Electron 首版漏注入 → 修复 #2)。
//   [feat: electron-replatform-macos] 2026-06-14
import { describe, expect, test } from "bun:test"

// local-asset.ts 顶层 `import { protocol } from "electron"`;electron 由 bunfig.toml [test].preload
// 的全局 mock 接管(见 ../../../test/electron-mock.ts,对任意文件执行顺序鲁棒)→ 这里直接 import 被测纯函数。
const { injectContextmenuBridge } = await import("./local-asset")

const MARK = "__deskfox"

describe("injectContextmenuBridge", () => {
  test("注入到 </head> 之前", () => {
    const html = Buffer.from("<html><head><title>x</title></head><body>hi</body></html>", "utf-8")
    const out = injectContextmenuBridge(html).toString("utf-8")
    expect(out).toContain(MARK)
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("</head>"))
    expect(out).toContain("<body>hi</body>")
  })

  test("无 </head> 时注入到 <body 之前(DOM ready 前注册 listener)", () => {
    const html = Buffer.from("<html><body>hi</body></html>", "utf-8")
    const out = injectContextmenuBridge(html).toString("utf-8")
    expect(out).toContain(MARK)
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("<body"))
  })

  test("无 head/body 锚点时前置兜底注入", () => {
    const html = Buffer.from("plain fragment no anchors", "utf-8")
    const out = injectContextmenuBridge(html).toString("utf-8")
    expect(out.startsWith("<script>")).toBe(true)
    expect(out).toContain("plain fragment")
  })

  test("非 UTF-8 原样返回(降级 native 菜单,不阻断渲染)", () => {
    const bad = Buffer.from([0xff, 0xfe, 0x00, 0x01])
    const out = injectContextmenuBridge(bad)
    expect(out.equals(bad)).toBe(true)
  })

  test("大写锚点 </HEAD> / <BODY 也命中", () => {
    const html = Buffer.from("<HTML><HEAD></HEAD><BODY>hi</BODY></HTML>", "utf-8")
    const out = injectContextmenuBridge(html).toString("utf-8")
    expect(out).toContain(MARK)
    expect(out.indexOf("<script>")).toBeLessThan(out.indexOf("</HEAD>"))
  })
})
