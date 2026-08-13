import { app, BrowserWindow, Menu } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import {
  DESKTOP_MENU,
  desktopMenuVisible,
  type DesktopMenuEntry,
  type DesktopMenuRole,
} from "@opencode-ai/app/desktop-menu"

import { UPDATER_ENABLED } from "./constants"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { openExternalURL } from "./windows"
import { nativeT, nativeLocale } from "./native-translations"
// FORK: 纯 role 菜单项译名回植(抽独立文件以便单测)[feat: native-role-menu-i18n] 2026-08-12
import { roleLabel } from "./menu-role-label"

type Deps = {
  trigger: (id: string) => void
  checkForUpdates: () => void
  relaunch: () => void
}

export function createMenu(deps: Deps) {
  if (process.platform !== "darwin") return

  const template = DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "macos")).map((menu) => {
    // FORK: 顶层带 role 的菜单**同时给出 submenu**,让其中的 role 项能挂中文 label
    //   [feat: mac-window-menu-i18n] 2026-08-13
    //   [bug-repro: [窗口] 菜单里 Minimize / Zoom / Bring All to Front 是英文,而同菜单其余项
    //    (全部最小化 / 填充 / 居中 / 平铺 / 移到显示器)都是中文。]
    //   查清的分野:**英文的三项恰好都是 Electron 定义的 role**(minimize/zoom/front),
    //   Electron 对它们硬编码英文 label;**中文的全是 AppKit 自动追加的系统项**,跟随系统语言。
    //   所以这不是本地化资源问题 —— 曾试过给 Info.plist 注入 CFBundleDevelopmentRegion +
    //   CFBundleLocalizations,实测**无效**(已回滚),因为压根不走 AppKit 那条路。
    //   原实现 `if (menu.role) return { role, label }` 顶层遇到 role 就直接返回、**吞掉了 items**,
    //   而 DESKTOP_MENU 里其实早已定义好中文 items —— 只是从没被用上。
    //   这里改为:仍带 role(保住 AppKit 把它识别为窗口菜单、继续追加系统项),
    //   同时把 items 渲染成 submenu,于是 Electron 的 role 项拿到我们的中文 label。
    if (menu.role) {
      const submenu = menu.items
        ?.filter((entry) => desktopMenuVisible(entry, "macos"))
        .map((entry) => nativeItem(entry, deps))
      if (!submenu || submenu.length === 0) {
        return { role: nativeRole(menu.role), label: nativeT(menu.labelKey) }
      }
      // FORK: 补回被替换掉的 Electron 默认项 [feat: mac-window-menu-i18n] 2026-08-13
      //   自定义 submenu 会整体覆盖 Electron 为 windowMenu 生成的默认项,
      //   实测因此丢了「缩放」与「前置全部窗口」(Bring All to Front)两个常用功能。
      //   **不能拿功能换语言** —— 这里把它们按 role 补回,并挂中文 label(复用 roleLabel 译名表)。
      //   AppKit 自动追加的系统项(填充 / 居中 / 平铺 / 移到显示器)不受影响,实测仍在。
      const extras = windowMenuExtras()
      return { role: nativeRole(menu.role), label: nativeT(menu.labelKey), submenu: [...submenu, ...extras] }
    }
    return {
      label: nativeT(menu.labelKey),
      submenu: menu.items
        ?.filter((entry) => desktopMenuVisible(entry, "macos"))
        .map((entry) => nativeItem(entry, deps)),
    }
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function nativeItem(entry: DesktopMenuEntry, deps: Deps): MenuItemConstructorOptions {
  if (entry.type === "separator") return { type: "separator" }
  if (entry.role)
    return {
      role: nativeRole(entry.role),
      // FORK: labelKey 缺省时(纯系统 role)按 locale 补中文译名,未覆盖语言仍回落 undefined
      // [feat: native-role-menu-i18n] 2026-08-12
      label: entry.labelKey ? nativeT(entry.labelKey) : roleLabel(entry.role, nativeLocale(), app.getName()),
    }

  const item: MenuItemConstructorOptions = {
    label: entry.labelKey ? nativeT(entry.labelKey) : undefined,
    accelerator: entry.accelerator?.macos,
    enabled: entry.enabled === "updater" ? UPDATER_ENABLED : undefined,
  }

  if (entry.command) {
    const command = entry.command
    item.click = () => deps.trigger(command)
  }
  if (entry.action) {
    const action = entry.action
    item.click = () =>
      runDesktopMenuAction(BrowserWindow.getFocusedWindow(), action, {
        checkForUpdates: deps.checkForUpdates,
        relaunch: deps.relaunch,
      })
  }
  if (entry.href) {
    const href = entry.href
    item.click = () => openExternalURL(href)
  }

  return item
}

function nativeRole(role: DesktopMenuRole) {
  return role as NonNullable<MenuItemConstructorOptions["role"]>
}


// FORK-BEGIN: [窗口] 菜单补项 [feat: mac-window-menu-i18n] 2026-08-13
// Electron 的 windowMenu 默认 submenu 一旦被自定义 submenu 覆盖,zoom / front 就没了。
// 这里按 role 补回并挂中文 label;未覆盖语言返回 undefined → 保持纯 role、退回系统默认标签。
function windowMenuExtras(): MenuItemConstructorOptions[] {
  const locale = nativeLocale()
  const name = app.getName()
  const zoom = roleLabel("zoom", locale, name)
  const front = roleLabel("front", locale, name)
  return [
    { type: "separator" },
    zoom ? { role: "zoom", label: zoom } : { role: "zoom" },
    front ? { role: "front", label: front } : { role: "front" },
  ]
}
// FORK-END
