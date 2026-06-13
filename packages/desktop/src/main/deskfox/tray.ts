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

// FORK: 托盘狐狸字形,品牌深蓝 #3D63A0(与 logo 同色;原黑色模板在 Win 托盘渲染发暗/不清)。
// 32x32 RGBA base64 内联,源 = branding/src/assets/tray-icons/default.png(由 icon-tray-template.svg fill=#3D63A0 生成)。
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
