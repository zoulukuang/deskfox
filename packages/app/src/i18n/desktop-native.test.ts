import { describe, expect, test } from "bun:test"
import {
  createDesktopNativeBundle,
  DESKTOP_NATIVE_ENGLISH,
  DESKTOP_NATIVE_KEYS,
  DESKTOP_NATIVE_LABELS,
  DESKTOP_NATIVE_LOCALES,
  DESKTOP_NATIVE_LOCALE_TAGS,
  detectDesktopNativeLocale,
  DESKTOP_NATIVE_MAX_PAYLOAD_BYTES,
  formatDesktopNativeMessage,
  parseDesktopNativeBundle,
} from "./desktop-native"

describe("desktop native translations", () => {
  test("uses native language names independent of the active locale", () => {
    expect(DESKTOP_NATIVE_LOCALES.map((locale) => DESKTOP_NATIVE_LABELS[locale])).toEqual([
      "English",
      "简体中文",
      "繁體中文",
      "한국어",
      "Deutsch",
      "Español",
      "Français",
      "Dansk",
      "日本語",
      "Polski",
      "Русский",
      "Українська",
      "Bosanski",
      "العربية",
      "Norsk",
      "Português (Brasil)",
      "ไทย",
      "Türkçe",
      "हिन्दी",
      "Nederlands",
      "Bahasa Indonesia",
      "Tiếng Việt",
      "Italiano",
      "اردو",
      "پنجابی",
      "Azərbaycanca",
      "Suomi",
      "Svenska",
      "አማርኛ",
      "Български",
      "বাংলা",
      "Català",
      "Čeština",
      "ދިވެހި",
      "རྫོང་ཁ",
      "Ελληνικά",
      "Eesti",
      "فارسی",
      "Føroyskt",
      "Hrvatski",
      "Magyar",
      "Հայերեն",
      "Íslenska",
      "ქართული",
      "ខ្មែរ",
      "ລາວ",
      "Lietuvių",
      "Latviešu",
      "Македонски",
      "Монгол",
      "Bahasa Melayu",
      "မြန်မာ",
      "नेपाली",
      "Română",
      "සිංහල",
      "Slovenčina",
      "Slovenščina",
      "Shqip",
      "Српски",
      "Тоҷикӣ",
      "Türkmençe",
      "Oʻzbekcha",
    ])
  })

  test("accepts the exact typed bundle", () => {
    const bundle = createDesktopNativeBundle("en", (key) => DESKTOP_NATIVE_ENGLISH[key])
    expect(parseDesktopNativeBundle(bundle)).toEqual(bundle)
  })

  test("rejects unsupported locales and mismatched key sets", () => {
    const bundle = createDesktopNativeBundle("en", (key) => DESKTOP_NATIVE_ENGLISH[key])
    expect(parseDesktopNativeBundle({ ...bundle, locale: "en-US" })).toBeUndefined()
    expect(
      parseDesktopNativeBundle({
        ...bundle,
        messages: Object.fromEntries(DESKTOP_NATIVE_KEYS.slice(1).map((key) => [key, bundle.messages[key]])),
      }),
    ).toBeUndefined()
    expect(parseDesktopNativeBundle({ ...bundle, messages: { ...bundle.messages, extra: "no" } })).toBeUndefined()
    expect(
      parseDesktopNativeBundle({
        ...bundle,
        messages: { ...bundle.messages, [DESKTOP_NATIVE_KEYS[0]]: "x".repeat(DESKTOP_NATIVE_MAX_PAYLOAD_BYTES) },
      }),
    ).toBeUndefined()
    expect(
      parseDesktopNativeBundle({ ...bundle, messages: { ...bundle.messages, [DESKTOP_NATIVE_KEYS[0]]: 1 } }),
    ).toBeUndefined()
  })

  test("interpolates native templates without changing unknown placeholders", () => {
    expect(formatDesktopNativeMessage("{{known}} {{unknown}}", { known: "yes" })).toBe("yes {{unknown}}")
  })
})

describe("desktop native locale detection", () => {
  test("follows preference order and skips invalid or unsupported tags", () => {
    expect(detectDesktopNativeLocale(["not_a_locale", "fr-FR"])).toBe("fr")
    expect(detectDesktopNativeLocale(["eo", "de-DE"])).toBe("de")
  })

  test("uses Unicode likely subtags for script-sensitive bundles", () => {
    expect(detectDesktopNativeLocale(["zh-TW"])).toBe("zht")
    expect(detectDesktopNativeLocale(["zh-SG"])).toBe("zh")
    expect(detectDesktopNativeLocale(["pa-PK"])).toBe("pa")
    expect(detectDesktopNativeLocale(["pa-IN", "fr"])).toBe("fr")
    expect(detectDesktopNativeLocale(["az-Cyrl", "de"])).toBe("de")
    expect(detectDesktopNativeLocale(["sr-Cyrl"])).toBe("sr")
    expect(detectDesktopNativeLocale(["sr-Latn", "en"])).toBe("en")
    expect(detectDesktopNativeLocale(["uz-Latn"])).toBe("uz")
  })

  // FORK-BEGIN: Aran(Nastaliq)script 归一化回归钉 2026-08-12
  test("treats the Aran script variant as Arab across ICU data versions", () => {
    // 新版 CLDR 把 pa-PK 的 likely script 从 Arab 改成 Aran(Arab 的 Nastaliq 书写变体),
    // 旧版仍给 Arab。两种 ICU 数据下都必须落到 pa,否则同一份代码在 Win / macOS 上行为分叉。
    expect(detectDesktopNativeLocale(["pa-Arab-PK"])).toBe("pa")
    expect(detectDesktopNativeLocale(["pa-Aran-PK"])).toBe("pa")
    // 归一化只针对 Arab 系变体,不得把别的文字系统也拉平:
    // pa-IN 是 Guru 文字,仍应跳过 pa 候选(pa-Arab-PK)去匹配下一个偏好。
    expect(detectDesktopNativeLocale(["pa-Guru-IN", "fr"])).toBe("fr")
  })
  // FORK-END

  test("recognizes Norwegian language tags", () => {
    expect(detectDesktopNativeLocale(["no"])).toBe("no")
    expect(detectDesktopNativeLocale(["nb-NO"])).toBe("no")
    expect(detectDesktopNativeLocale(["nn-NO"])).toBe("no")
  })
})

describe("desktop native ICU data", () => {
  test("accepts every locale in standard Intl formatters", () => {
    for (const locale of DESKTOP_NATIVE_LOCALES) {
      const tag = DESKTOP_NATIVE_LOCALE_TAGS[locale]
      expect(() => new Intl.Locale(tag), `${locale} locale`).not.toThrow()
      expect(() => new Intl.NumberFormat(tag), `${locale} number`).not.toThrow()
      expect(() => new Intl.DateTimeFormat(tag), `${locale} date`).not.toThrow()
      expect(() => new Intl.PluralRules(tag), `${locale} plural`).not.toThrow()
      expect(() => new Intl.ListFormat(tag), `${locale} list`).not.toThrow()
      expect(() => new Intl.DisplayNames(tag, { type: "language" }), `${locale} names`).not.toThrow()
      expect(() => new Intl.Segmenter(tag), `${locale} segmenter`).not.toThrow()
    }
  })
})
