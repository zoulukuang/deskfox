// FORK-ONLY: 原生右键菜单管理 — 按语言重挂 electron-context-menu [feat: native-menu-i18n]
// 首次用 OS locale 兜底(renderer 尚未启动时的早期菜单),renderer 语言设置就绪/变更后经
// deskfox:set_context_menu_language 同步真实 app 语言并重挂。

import { app } from "electron"
import contextMenu from "electron-context-menu"
import { labelsFor, normalizeMenuLocale } from "./context-menu-labels"

let dispose: (() => void) | undefined
let current: string | undefined

export function applyContextMenuLanguage(locale?: string) {
  const normalized = normalizeMenuLocale(locale ?? app.getLocale())
  if (normalized === current && dispose) return
  dispose?.()
  current = normalized
  dispose = contextMenu({
    showSaveImageAs: true,
    showLookUpSelection: false,
    showSearchWithGoogle: false,
    labels: labelsFor(normalized),
  })
}
