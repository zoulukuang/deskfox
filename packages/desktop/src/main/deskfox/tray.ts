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

// FORK: 托盘狐狸字形,品牌蓝 #7295c4(与 logo 同色;原黑色模板在 Win 托盘渲染发暗/不清)。
// 40x40 RGBA base64 内联(几何同 branding/src/assets/tray-icons/source/icon-tray-template.svg,改 fill→#7295c4)。
const TRAY_ICON_PNG_BASE64 =
  "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"

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
