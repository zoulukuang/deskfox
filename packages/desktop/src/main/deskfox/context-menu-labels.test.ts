// FORK-ONLY test: native-menu-i18n — labels 覆盖完整性与 locale 归一 [feat: native-menu-i18n]
import { describe, expect, test } from "bun:test"
import { labelsFor, normalizeMenuLocale, SUPPORTED_MENU_LOCALES } from "./context-menu-labels"

const REQUIRED = [
  "cut",
  "copy",
  "paste",
  "selectAll",
  "copyLink",
  "saveLinkAs",
  "copyImage",
  "copyImageAddress",
  "saveImage",
  "saveImageAs",
  "copyEmail",
  "inspect",
]

describe("context-menu-labels", () => {
  test("app 全部 19 个语言都有完整标签集", () => {
    const appLocales = [
      "ar", "br", "bs", "da", "de", "en", "es", "fr", "ja", "ko",
      "no", "pl", "ru", "th", "tr", "uk", "zh", "zht",
    ]
    for (const locale of appLocales) {
      const labels = labelsFor(locale)
      for (const key of REQUIRED) {
        expect(labels[key], `${locale}.${key}`).toBeTruthy()
      }
    }
    expect(SUPPORTED_MENU_LOCALES.length).toBeGreaterThanOrEqual(18)
  })

  test("zh 关键文案", () => {
    const zh = labelsFor("zh")
    expect(zh.copy).toBe("复制")
    expect(zh.paste).toBe("粘贴")
    expect(zh.copyLink).toBe("复制链接")
  })

  test("locale 归一:OS 形态/繁体/葡语/挪威语/未知回退", () => {
    expect(normalizeMenuLocale("zh-CN")).toBe("zh")
    expect(normalizeMenuLocale("zh-TW")).toBe("zht")
    expect(normalizeMenuLocale("zh-Hant")).toBe("zht")
    expect(normalizeMenuLocale("pt-BR")).toBe("br")
    expect(normalizeMenuLocale("nb-NO")).toBe("no")
    expect(normalizeMenuLocale("fr-FR")).toBe("fr")
    expect(normalizeMenuLocale("xx-YY")).toBe("en")
    expect(normalizeMenuLocale(undefined)).toBe("en")
  })

  test("labelsFor 未知 locale 回退英文", () => {
    expect(labelsFor("klingon").copy).toBe("Copy")
  })
})
