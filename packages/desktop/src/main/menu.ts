import { app, BrowserWindow, Menu, shell } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import {
  DESKTOP_MENU,
  desktopMenuVisible,
  type DesktopMenuEntry,
  type DesktopMenuRole,
} from "@opencode-ai/app/desktop-menu"
// FORK: 原生菜单标签跟随应用内全局语言(复用 fork 翻译表)[feat: settings-panel-cleanup] 2026-06-15
import { translateMenuLabel } from "@opencode-ai/app/desktop-menu-i18n"

import { UPDATER_ENABLED } from "./constants"
import { runDesktopMenuAction } from "./desktop-menu-actions"

type Deps = {
  trigger: (id: string) => void
  checkForUpdates: () => void
  relaunch: () => void
}

// FORK: 菜单在主进程启动时一次性构建(英文),渲染进程拿到当前 locale 后经 IPC 推回触发重建,
// 实现原生菜单跟随应用内语言设置。保留 deps + locale 模块态以便随时重建。[feat: settings-panel-cleanup] 2026-06-15
let menuDeps: Deps | undefined
let menuLocale: string | undefined

export function createMenu(deps: Deps) {
  if (process.platform !== "darwin") return
  menuDeps = deps
  rebuildMenu()
}

// FORK: 渲染进程语言变化时调用,locale 不变则跳过,避免无谓重建 [feat: settings-panel-cleanup] 2026-06-15
export function setMenuLocale(locale: string | undefined) {
  if (locale === menuLocale) return
  menuLocale = locale
  if (menuDeps) rebuildMenu()
}

function rebuildMenu() {
  if (process.platform !== "darwin" || !menuDeps) return
  const deps = menuDeps

  const template = DESKTOP_MENU.filter((menu) => desktopMenuVisible(menu, "macos")).map((menu) => {
    // FORK: 顶层带 role 的菜单(如 Window/windowMenu)也套译名,label 仅管显示不影响 role 行为
    // [feat: settings-panel-cleanup] 2026-06-15
    if (menu.role) return withLabel({ role: nativeRole(menu.role) }, translatedLabel(menu.label))
    return {
      label: translatedLabel(menu.label) ?? menu.label,
      submenu: menu.items
        ?.filter((entry) => desktopMenuVisible(entry, "macos"))
        .map((entry) => nativeItem(entry, deps)),
    }
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function nativeItem(entry: DesktopMenuEntry, deps: Deps): MenuItemConstructorOptions {
  if (entry.type === "separator") return { type: "separator" }
  // FORK: role 项也跟随语言 — 带 label 的(Undo/Copy/缩放…)用翻译表覆盖显示;
  // 纯系统 role(About/Hide/Quit…)用带应用名的译名;无译文时退回原生(系统语言)
  // [feat: settings-panel-cleanup] 2026-06-15
  if (entry.role) {
    const label = entry.label ? translatedLabel(entry.label) : roleLabel(entry.role)
    return withLabel({ role: nativeRole(entry.role) }, label)
  }

  const item: MenuItemConstructorOptions = {
    label: entry.label ? translateMenuLabel(entry.label, menuLocale) : entry.label,
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
    item.click = () => shell.openExternal(href)
  }

  return item
}

function nativeRole(role: DesktopMenuRole) {
  return role as NonNullable<MenuItemConstructorOptions["role"]>
}

// FORK: 仅当存在真实译文(译后 ≠ 原英文)时才返回,否则 undefined → 退回原生标签(系统语言),
// 保证英文/未翻译语言下行为与上游 100% 一致 [feat: settings-panel-cleanup] 2026-06-15
function translatedLabel(label: string): string | undefined {
  const translated = translateMenuLabel(label, menuLocale)
  return translated !== label ? translated : undefined
}

// FORK: role + 可选 label 合成(label 缺省则保持纯 role,沿用原生默认显示与快捷键)
function withLabel(item: MenuItemConstructorOptions, label: string | undefined): MenuItemConstructorOptions {
  return label ? { ...item, label } : item
}

// FORK: 纯系统 role 在 DESKTOP_MENU 里无英文 label,无法走 translateMenuLabel — 这里按 role 直接给带应用名译名;
// 未翻译语言返回 undefined → 退回 macOS 系统语言默认 [feat: settings-panel-cleanup] 2026-06-15
function roleLabel(role: DesktopMenuRole): string | undefined {
  const name = app.getName()
  const maps: Record<string, Partial<Record<DesktopMenuRole, string>>> = {
    zh: {
      about: `关于 ${name}`,
      hide: `隐藏 ${name}`,
      hideOthers: "隐藏其他",
      unhide: "全部显示",
      quit: `退出 ${name}`,
    },
    zht: {
      about: `關於 ${name}`,
      hide: `隱藏 ${name}`,
      hideOthers: "隱藏其他",
      unhide: "全部顯示",
      quit: `結束 ${name}`,
    },
  }
  return menuLocale ? maps[menuLocale]?.[role] : undefined
}
