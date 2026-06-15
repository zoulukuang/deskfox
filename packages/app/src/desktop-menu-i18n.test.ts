// [fork-only] 守卫:macOS 原生菜单 + Windows 应用菜单都依赖 translateMenuLabel 把 DESKTOP_MENU 的
// 英文标签译成当前语言(见 desktop/src/main/menu.ts、windows-app-menu.tsx)。
// 若新增菜单项却忘了往 desktop-menu-i18n 加译文,中文界面就会泄漏英文 —— 本测试在 CI 拦下。
// [feat: settings-panel-cleanup] 2026-06-15
import { describe, expect, test } from "bun:test"
import { DESKTOP_MENU } from "./desktop-menu"
import { translateMenuLabel } from "./desktop-menu-i18n"

// 顶层 app 菜单 label 在 macOS 上恒被替换为应用名(品牌),不需要也不应翻译。
const BRAND_TOP_LABELS = new Set(["OpenCode"])

const TRANSLATED_LOCALES = ["zh", "zht"] as const

function collectLabels() {
  const top: string[] = []
  const items: string[] = []
  for (const menu of DESKTOP_MENU) {
    if (!BRAND_TOP_LABELS.has(menu.label)) top.push(menu.label)
    for (const entry of menu.items ?? []) {
      if (entry.type === "item" && entry.label) items.push(entry.label)
    }
  }
  return { top, items }
}

describe("desktop menu i18n", () => {
  for (const locale of TRANSLATED_LOCALES) {
    test(`every menu label has a ${locale} translation`, () => {
      const { top, items } = collectLabels()
      const missing = [...top, ...items].filter((label) => translateMenuLabel(label, locale) === label)
      expect(missing).toEqual([])
    })
  }

  test("unknown locale falls back to the original English label", () => {
    expect(translateMenuLabel("Toggle Terminal", "en")).toBe("Toggle Terminal")
    expect(translateMenuLabel("Check for Updates...", undefined)).toBe("Check for Updates...")
  })

  test("known labels translate as expected (zh)", () => {
    expect(translateMenuLabel("Check for Updates...", "zh")).toBe("检查更新…")
    expect(translateMenuLabel("Toggle Terminal", "zh")).toBe("切换终端")
    expect(translateMenuLabel("Settings", "zh")).toBe("设置")
  })
})
