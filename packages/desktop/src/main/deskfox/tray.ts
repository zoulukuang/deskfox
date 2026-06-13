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
// 32x32 RGBA base64 内联,源 = branding/src/assets/tray-icons/default.png(由 icon-tray-template.svg fill=#7295C4 生成)。
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
