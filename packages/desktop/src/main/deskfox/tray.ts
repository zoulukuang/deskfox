// FORK-ONLY: DeskFox 系统托盘 + 关闭到托盘 + 退出意图 [feat: electron-replatform] 2026-06-12
//
// 从 Tauri system_tray.rs 平移:
//   - 托盘图标 + 菜单(打开 / 状态 / 保持电脑不休眠 勾选 / 退出)
//   - 关 GUI ≠ 退主进程:主窗口 close 默认拦截 → hide;仅"退出"菜单放行真退
//   - 防休眠勾选项与设置页双入口同步(订阅 prevent-sleep onPreventSleepChanged)
// 图标内联 base64(对齐 Tauri include_image! 编译期嵌入,运行时无文件 IO,dev/打包一致)。
// 菜单文案 hardcode 中文(DeskFox 中文环境定调,同 Tauri 版)。
//
// REQ-099(2026-08-07):托盘接上 sidecar 看门狗健康状态 —— 三态图标 + 菜单文案。
// 图标常量改由 tray-icons.generated.ts 提供(生成脚本 branding/scripts/gen-tray-icons.py),
// 状态→文案/图标的映射在 tray-status.ts(纯函数可单测)。[feat: tray-health-status]

import { app, Tray, Menu, nativeImage, BrowserWindow, type MenuItemConstructorOptions } from "electron"
import { getPreventSleep, setPreventSleep, onPreventSleepChanged } from "./prevent-sleep"
import { write as writeLog } from "../logging"
import { mapWatchdogStatusToTray, TRAY_STATUS_READY, type TrayIconKey } from "./tray-status"
import { TRAY_ICON_COLOR_BASE64, TRAY_ICON_MAC_TEMPLATE_BASE64 } from "./tray-icons.generated"

// FORK: 托盘图标三态(ok / restarting / gave-up)x 两模式,均为 32x32 RGBA base64 内联,
// 由 packages/branding/scripts/gen-tray-icons.py 生成 -> ./tray-icons.generated.ts(勿手改)。
//   - 彩色版(Win/Linux 托盘):品牌深蓝 #3D63A0 狐狸 + 状态徽标(纯黑模板在 Win 托盘发暗/不清)
//   - mac template 版:纯黑 alpha 廓形,setTemplateImage(true) 后系统按菜单栏明暗自动反色;
//     32px buffer 当 @2x(scaleFactor:2)-> 16pt 逻辑尺寸(Retina 清晰)
//   /!\ template 只保留 alpha、颜色全丢 -> gave-up 的感叹号必须【挖成透明洞】才与 restarting 有别。
// [feat: viewer-selection-tray-style / tray-health-status]

let tray: Tray | null = null
let isQuittingFlag = false
let statusItem: MenuItem | null = null
let preventSleepItem: MenuItem | null = null

// FORK: REQ-099 —— 当前状态存模块级变量,buildMenu() 读它。
// 修 bug:原先 setTrayStatus 先写 statusItem.label 再 setContextMenu(buildMenu()),
// 而 buildMenu() 从模板重建、label 写死"状态:就绪"并重新给 statusItem 赋值
// → 刚设的文案当场被覆盖,预留接口"调了也没用"。[feat: tray-health-status]
let currentStatusLabel = TRAY_STATUS_READY.label
let currentIcon: TrayIconKey = TRAY_STATUS_READY.icon

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
    { id: "status", label: currentStatusLabel, enabled: false },
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

// FORK: macOS 用 template image(纯黑 alpha,系统按菜单栏明暗反色 → 暗菜单栏显白,与系统图标统一);
// 32px buffer 当 @2x(scaleFactor:2)→ 16pt 逻辑尺寸(Retina 清晰,原 32 偏大)。
// Win/Linux 无 template 反色概念,纯黑在浅色托盘发暗,保留品牌蓝彩色固定色。[feat: viewer-selection-tray-style]
function buildIcon(key: TrayIconKey): Electron.NativeImage {
  if (process.platform === "darwin") {
    const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_MAC_TEMPLATE_BASE64[key], "base64"), {
      scaleFactor: 2,
    })
    icon.setTemplateImage(true)
    return icon
  }
  return nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_COLOR_BASE64[key], "base64"))
}

/** app.whenReady 后调用一次,注册托盘图标 + 菜单。 */
export function createTray(): Tray {
  if (tray) return tray
  tray = new Tray(buildIcon(currentIcon))
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

/**
 * FORK: REQ-099 —— 看门狗状态 → 托盘图标 + 菜单文案。
 * 状态来源在主进程(index.ts 的 watchdog emit 回调直接调,不经 renderer / 不新增 IPC)。
 * 未知状态(含 memory-brake 的 memory-pressure)由映射函数返 undefined → 不改托盘。
 * [feat: tray-health-status] 2026-08-07
 */
export function setTrayStatus(status: string): void {
  const view = mapWatchdogStatusToTray(status)
  if (!view) return
  if (view.label === currentStatusLabel && view.icon === currentIcon) return // 无变化不刷新(避免图标闪烁)
  const iconChanged = view.icon !== currentIcon
  currentStatusLabel = view.label
  currentIcon = view.icon
  writeLog("utility", "[deskfox-tray] status changed", { status, label: view.label, icon: view.icon })
  // 重建菜单以反映文案(Electron 菜单 label 改后需重设);buildMenu() 读 currentStatusLabel
  if (tray) {
    tray.setContextMenu(buildMenu())
    if (iconChanged) tray.setImage(buildIcon(currentIcon))
  }
}

/** 仅供测试:重置模块级状态(bun:test 同进程复用模块)。 */
export function __resetTrayStateForTest(): void {
  tray = null
  statusItem = null
  preventSleepItem = null
  currentStatusLabel = TRAY_STATUS_READY.label
  currentIcon = TRAY_STATUS_READY.icon
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
