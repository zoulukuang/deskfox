// FORK-ONLY: DeskFox 系统托盘 + 关闭到托盘 + 退出意图 [feat: electron-replatform] 2026-06-12
//
// 从 Tauri system_tray.rs 平移:
//   - 托盘图标 + 菜单(打开 / 状态 / 保持电脑不休眠 勾选 / 退出)
//   - 关 GUI ≠ 退主进程:主窗口 close 默认拦截 → hide;仅"退出"菜单放行真退
//   - 防休眠勾选项与设置页双入口同步(订阅 prevent-sleep onPreventSleepChanged)
// 图标内联 base64(对齐 Tauri include_image! 编译期嵌入,运行时无文件 IO,dev/打包一致)。
// 4 状态图标当前为同一占位图(renderer 不驱动状态);状态切换接口留 setTrayStatus 备用。
// 菜单文案 hardcode 中文(DeskFox 中文环境定调,同 Tauri 版)。

import { app, Tray, Menu, nativeImage, BrowserWindow, type MenuItemConstructorOptions } from "electron"
import { getPreventSleep, setPreventSleep, onPreventSleepChanged } from "./prevent-sleep"
import { write as writeLog } from "../logging"

// default.png(40x40 RGBA)base64 内联 — 同 Tauri branding/src/assets/tray-icons/default.png
const TRAY_ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAEsUlEQVR4nO3Y71WjWByH8e+tQKxgSAVDKliswKSCJRWYqWBjBcYKllRgrEC2gmAFxgokHexzl8mKDBD+x9nZ55zPwRc5Ir8LuTFGv3h9DMCVtNd5ctXx3AZde8EUCcbMwQ4TtM6gS4GkPzHHFmM2wwMWCNUygy69wJW0QaBxCyX9jr063AUGbQuUrr4twSXG7A0ObAuEapFBm+yJd3D13hQxxsiDPf+xvVreBQZtWkn6A9nuscQYrXGDbLdYqWEGTXPwAnvMFmOKMdrBQ7YEE9hj7QyattKPq39sgr2GzVW6AEXdYqUGGTTJgT25PRb1DWsM2RJ3KCrBBPZYK4MmrVS++rZHzDBkW1yjrFusVDODujl4gT1WdYkEQ+TgDVUlmMAeT2ZQt5WqV//YHFsM0QwPONUtVqqRQZ1cpe+8Dk61QaBhCpV++jtVghnssTKDOoWqd2KbPeklhugNDuq0QaATGZzKVfrsN2mKGH3mYYcmTbBXRQanClV/9Y/dY4k+W+MGTdogUEUGVblqvvq2GFP02Q4emjbBXiUZVBWq+eofm2CvfnLVbiFsGwQqyaAsV+1PavuGNfpoiTu0bYK9CjIoK1T71bc9YoY+2uIabdsgUEEGRfmSntC1SyTokoM3dG2KGB8qG4C9eF/dm2OLLs3wgK5Fkq7wIYN8vtIB9NEGgboVqtujmO0KkTIZ5HuCr35KcIkuvcFBH0VKh/BvBtl8pQPosylitMnDDn12hUjfM8i2xTVsMRLk2yuVz742xhh5cJDPVSqffa0H2yNm+CeDbL76vwM+W1eI9D2DfIHev+//r7VAqEwGRa1U78uPn6lbrJTLoKxQ7befV0RKn7uv6NIzYsxwgTZtEKggg6oiSb+hSa/wkMC2xTXa9IgZbA5ifEGT/oKvkgyqchCp2SreY4ljvtq/sV4h0ntr3KBuz/D1vhg/ZHAqV+nkL1CnSOkffmyJO7RpgVDv2UH6qtcBriou3mZQJw+R6g9hjS1cpT87aFOCJfZKH4Ul6mQv3le6cJUZ1G2GB/wMzbHFyZoMwBbo839GWCBUzQyatsYNPmP3WKJ2bQZgC3X6M8IBMfrIwwWq2iBQwwzaFuMrqprCvq5LHnao6hn2dY3rMgAHkaqHEGOKLu3goaxn+Ep3jMZ1GYDNVXqRFyjrFiu1a6Xq/0kO8LBXywy6Zv+ASNVDmCJGkzzsUNYBvpr/3g/1MQBboOrtMdLHT4d1eoKv8ubYolMGfRWoegjfsEadlrhDWQuE6iGDPgtVvj0mmGKv6lylt76DojYI1FMGfReqfAiRTj8KT/BV3AaBesyg7+zKRSrfHhcIVVyg8sfoGb7SO6m3DIbIQaTiISSYwB6zOXiBPeYb5OJtBkPlIVLx9rjFHNkeMEO+A3x13O7KGnIANg+Riocwxxa2GR6Q7wBfA128begB2AIVP9cJJrC9wEG+BUINmMEYLXGHfPew3SDfAqEGzmCsQpVvj/k2CDRCBmO2xTWqesQMozT2ABxEKt4ebc/wlb4/jNLYA7A5iPEF2V7hIcFoGZwjD5Het8cDfKWDGbVzDcDmYQfbFDFG75wDsAVKC3Wmzj2As/f/APBL9zdMH/RBjG58/wAAAABJRU5ErkJggg=="

let tray: Tray | null = null
let isQuittingFlag = false
let statusItem: MenuItem | null = null
let preventSleepItem: MenuItem | null = null

// Electron MenuItem 类型(从 Menu.items 取),避免引入额外导入
type MenuItem = Electron.MenuItem

/** 标记"已请求退出主进程"。退出菜单 / 真退路径调,之后主窗口 close 不再拦截。 */
export function setQuitting(): void {
  isQuittingFlag = true
}
export function isQuitting(): boolean {
  return isQuittingFlag
}

/** 显示并聚焦主窗口(托盘菜单"打开" + 左键单击 + second-instance 共用)。 */
export function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    { id: "open", label: "打开 DeskFox", click: () => showMainWindow() },
    { id: "status", label: "状态:就绪", enabled: false },
    {
      id: "prevent-sleep",
      label: "保持电脑不休眠",
      type: "checkbox",
      checked: getPreventSleep(),
      click: (item) => setPreventSleep({ enabled: item.checked }),
    },
    { type: "separator" },
    {
      id: "quit",
      label: "退出 DeskFox",
      click: () => {
        setQuitting()
        app.quit()
      },
    },
  ]
  const menu = Menu.buildFromTemplate(template)
  statusItem = menu.getMenuItemById("status")
  preventSleepItem = menu.getMenuItemById("prevent-sleep")
  return menu
}

/** app.whenReady 后调用一次,注册托盘图标 + 菜单。 */
export function createTray(): Tray {
  if (tray) return tray
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, "base64"))
  tray = new Tray(icon)
  tray.setToolTip("DeskFox")
  tray.setContextMenu(buildMenu())
  // 左键单击(Win/mac)→ 打开主窗口
  tray.on("click", () => showMainWindow())

  // 防休眠勾选与设置页双入口同步
  onPreventSleepChanged((enabled) => {
    if (preventSleepItem) preventSleepItem.checked = enabled
  })
  return tray
}

/** 切换托盘状态菜单文案(状态来源在主进程,renderer 不驱动)。预留接口。 */
export function setTrayStatus(label: string): void {
  if (statusItem) statusItem.label = label
  if (tray) tray.setContextMenu(buildMenu()) // 重建以反映文案(Electron 菜单 label 改后需重设)
}

/**
 * 关闭到托盘 + 退出前 flush 钩子。index.ts 在 createMainWindow 后调。
 * 主窗口 close:非退出意图 → 阻止 + 发 flush 事件 + hide(主进程常驻,飞书/边车不退)。
 * 对齐 Tauri lib.rs WindowEvent::CloseRequested(emit deskfox-flush-before-close + prevent_close + hide)。
 */
export function attachCloseToTray(win: BrowserWindow): void {
  win.on("close", (e) => {
    writeLog("window", "[deskfox-tray] window close", { isQuitting: isQuittingFlag })
    // 非退出意图 → 先拦截(preventDefault 必须先于任何可能抛错的调用)
    if (!isQuittingFlag) {
      e.preventDefault()
      win.hide()
    }
    // 发 flush 事件,renderer listener 立即触发未保存文件的 silent save(send 包 try 防抛断流程)
    try {
      win.webContents.send("deskfox:deskfox-flush-before-close")
    } catch {
      /* webContents 已销毁(真退出路径)忽略 */
    }
  })
}
