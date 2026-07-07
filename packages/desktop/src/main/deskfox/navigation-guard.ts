// FORK-ONLY: REQ-075 主窗口导航兜底 [feat: batch-port-edit-mdlink] 2026-07-07
//
// 背景:聊天区 md 相对链接曾因 renderer 漏接拦截走原生 <a> 导航,把整个 SPA 导航掉 → 界面空白。
// renderer 侧已修(md-link-click.ts),本模块是 main 进程兜底:即便未来又有"忘接线"的链接,
// 最多链接无反应/转外部浏览器,绝不再整窗导航空白。
//
// 两道闸:
//   1. will-navigate — SPA 不存在合法的整页导航(loadURL/reload 不触发本事件,history API 走
//      in-page 也不触发)→ 一律 preventDefault;http(s) 顺手转系统浏览器(与 open-link IPC 同语义)。
//   2. setWindowOpenHandler — 此前缺席,target=_blank/window.open 默认弹裸 Electron 新窗
//      (message-part.tsx exa/webfetch 硬编码 _blank 链接实测如此)→ http(s) 转系统浏览器,其余 deny。
//
// 不影响聊天 markdown 外链既有链路(a.external-link 全局点击委托在 click 期已 preventDefault +
// IPC shell.openExternal,根本走不到 navigation),2026-07-07 实测核实。
import { shell, type BrowserWindow } from "electron"

const isHttp = (url: string) => /^https?:/i.test(url)

/** will-navigate 决策:block=阻断导航,openExternal=转系统浏览器(纯函数,单测覆盖) */
export function decideNavigation(url: string): { block: boolean; openExternal: boolean } {
  return { block: true, openExternal: isHttp(url) }
}

/** window.open/target=_blank 决策:一律 deny,http(s) 转系统浏览器(纯函数,单测覆盖) */
export function decideWindowOpen(url: string): { deny: boolean; openExternal: boolean } {
  return { deny: true, openExternal: isHttp(url) }
}

export function wireNavigationGuard(win: BrowserWindow) {
  win.webContents.on("will-navigate", (event, url) => {
    const d = decideNavigation(url)
    if (d.block) {
      event.preventDefault()
      console.warn(`[navigation-guard] blocked will-navigate to ${url}${d.openExternal ? " (opened externally)" : ""}`)
    }
    if (d.openExternal) void shell.openExternal(url)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    const d = decideWindowOpen(url)
    if (d.openExternal) void shell.openExternal(url)
    return { action: "deny" }
  })
}
