// [fork-only] REQ-075 导航兜底决策单测 — SPA 无合法整页导航一律拦;http(s) 转系统浏览器;
// window.open/_blank 一律 deny(此前默认弹裸 Electron 窗)。wire 层胶水由 CDP E5 验证。
// electron 由 bunfig.toml [test].preload 全局 mock 接管。
//   [feat: batch-port-edit-mdlink] 2026-07-07
import { describe, expect, test } from "bun:test"

const { decideNavigation, decideWindowOpen, wireNavigationGuard } = await import("./navigation-guard")

describe("decideNavigation(will-navigate,REQ-075 兜底)", () => {
  test("oc:// 内部相对链接被误导航(漏接线场景)→ 拦,不转外部", () => {
    expect(decideNavigation("oc://renderer/需求池/xxx.md")).toEqual({ block: true, openExternal: false })
  })

  test("http(s) → 拦 + 转系统浏览器", () => {
    expect(decideNavigation("https://example.com/x")).toEqual({ block: true, openExternal: true })
    expect(decideNavigation("http://example.com/x")).toEqual({ block: true, openExternal: true })
  })

  test("其他协议(file/javascript)→ 拦,不转外部", () => {
    expect(decideNavigation("file:///etc/passwd")).toEqual({ block: true, openExternal: false })
    expect(decideNavigation("javascript:alert(1)")).toEqual({ block: true, openExternal: false })
  })
})

describe("decideWindowOpen(window.open/_blank,REQ-075 兜底)", () => {
  test("http(s)(exa/webfetch 硬编码 _blank 链接)→ deny + 转系统浏览器(不再弹裸窗)", () => {
    expect(decideWindowOpen("https://example.com/deskfox-probe")).toEqual({ deny: true, openExternal: true })
  })

  test("非 http(s) → deny,不转外部", () => {
    expect(decideWindowOpen("oc://renderer/x")).toEqual({ deny: true, openExternal: false })
    expect(decideWindowOpen("file:///x")).toEqual({ deny: true, openExternal: false })
  })
})

describe("wireNavigationGuard 接线", () => {
  test("will-navigate 被 preventDefault;window.open 返回 deny", () => {
    const handlers: Record<string, (...args: any[]) => any> = {}
    let openHandler: ((details: { url: string }) => { action: string }) | undefined
    const win = {
      webContents: {
        on: (event: string, cb: (...args: any[]) => any) => {
          handlers[event] = cb
        },
        setWindowOpenHandler: (cb: (details: { url: string }) => { action: string }) => {
          openHandler = cb
        },
      },
    }
    wireNavigationGuard(win as never)

    let prevented = false
    handlers["will-navigate"]({ preventDefault: () => (prevented = true) }, "oc://renderer/xxx.md")
    expect(prevented).toBe(true)

    expect(openHandler!({ url: "https://example.com" })).toEqual({ action: "deny" })
    expect(openHandler!({ url: "oc://renderer/x" })).toEqual({ action: "deny" })
  })
})
