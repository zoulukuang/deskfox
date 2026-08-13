// [fork-only] 纯系统 role 菜单项的中文译名 [feat: native-role-menu-i18n] 2026-08-12
//
// 背景:About / Hide / Hide Others / Show All / Quit 这几项在 DESKTOP_MENU 里**没有 labelKey**
// (靠 Electron 的 role 自带标签),因此走不到 nativeT —— 上游 i18n 方案只翻译带 labelKey 的项。
// Electron 的 role 默认标签跟随 app bundle 本地化而非系统语言,实测在中文系统下仍显示英文,
// 结果是「应用菜单一半中文一半英文」。
//
// 本文件是 2026-08 上游同步前 fork 自有实现(原 menu.ts 的 roleLabel,段4「菜单上游化」时随
// desktop-menu-i18n.ts 一并撤除)的**回植**:2026-08-12 Mac 端真机 A/B 比对(正式版 vs 本分支
// local 包读 macOS 菜单栏)实证该能力丢失,故按原语义补回。
//
// 独立成文件而非留在 menu.ts:menu.ts 顶层 import electron,单测环境加载不了(bun 报
// "Export named 'nativeTheme' not found"),抽出纯函数才能进 Logic 清单被测试覆盖。
//
// 未覆盖的语言返回 undefined → 保持纯 role,退回 Electron/系统默认标签(不回归)。
// FORK: 本表的 key 不限于上游 DesktopMenuRole —— zoom / front 是 Electron windowMenu
//   默认项的 role,上游那个联合类型里没有,故用宽松的 string key。
//   [feat: mac-window-menu-i18n] 2026-08-13
export type MenuRoleName = string

const ROLE_LABELS: Record<string, Record<string, (name: string) => string>> = {
  zh: {
    about: (n) => `关于 ${n}`,
    hide: (n) => `隐藏 ${n}`,
    hideOthers: () => "隐藏其他",
    unhide: () => "全部显示",
    quit: (n) => `退出 ${n}`,
    // FORK: [窗口] 菜单补项 [feat: mac-window-menu-i18n] 2026-08-13
    zoom: () => "缩放",
    front: () => "前置全部窗口",
  },
  zht: {
    about: (n) => `關於 ${n}`,
    hide: (n) => `隱藏 ${n}`,
    hideOthers: () => "隱藏其他",
    unhide: () => "全部顯示",
    quit: (n) => `結束 ${n}`,
    zoom: () => "縮放",
    front: () => "前置全部視窗",
  },
}

export function roleLabel(role: MenuRoleName, locale: string, appName: string): string | undefined {
  return ROLE_LABELS[locale]?.[role]?.(appName)
}
