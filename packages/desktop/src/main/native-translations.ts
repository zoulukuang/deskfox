import {
  DESKTOP_NATIVE_ENGLISH,
  DESKTOP_NATIVE_KEYS,
  formatDesktopNativeMessage,
  type DesktopNativeBundle,
  type DesktopNativeKey,
} from "@opencode-ai/app/i18n/desktop-native"

let bundle: DesktopNativeBundle = { locale: "en", messages: { ...DESKTOP_NATIVE_ENGLISH } }

export function setNativeTranslations(next: DesktopNativeBundle) {
  if (
    next.locale === bundle.locale &&
    DESKTOP_NATIVE_KEYS.every((key) => next.messages[key] === bundle.messages[key])
  ) {
    return false
  }
  bundle = next
  return true
}

export function nativeT(key: DesktopNativeKey, params?: Record<string, string | number>) {
  return formatDesktopNativeMessage(bundle.messages[key], params)
}

// FORK: 暴露当前 bundle 的 locale —— 纯系统 role 菜单项(about/hide/quit…)在 DESKTOP_MENU 里
// 没有 labelKey,走不了 nativeT,需按 locale 单独给译名(见 menu.ts roleLabel)。
// [feat: native-role-menu-i18n] 2026-08-12
export function nativeLocale() {
  return bundle.locale
}
