// [fork-only] DeskFox 桌面应用菜单(WindowsAppMenu)标签本地化
//
// 背景:上游 `desktop-menu.ts` 的 DESKTOP_MENU 标签是硬编码英文,且该结构同时给 macOS 原生菜单用,
// 不便直接塞 i18n key。这里用一张「语言 → (英文原标签 → 译文)」映射表,在 windows-app-menu.tsx 渲染时
// 按当前 locale 翻译,查不到则原样返回英文(不回归)。新增语言只需往本表加一档,零改上游 i18n 文件。
//
// user 反馈(2026-06-13):通用设置已是简体中文,但应用菜单仍英文 → 菜单语言要跟随语言设置。
// 当前提供 zh(简体)/ zht(繁体);其余语言暂回退英文,后续按需补档。 [feat: titlebar-icons-rearrange]

const ZH: Record<string, string> = {
  // 顶层
  File: "文件",
  Edit: "编辑",
  View: "视图",
  Go: "前往",
  Window: "窗口",
  Help: "帮助",
  // OpenCode / 应用
  "Check for Updates...": "检查更新…",
  Settings: "设置",
  "Reload Webview": "重新加载页面",
  Restart: "重启",
  "Export Logs...": "导出日志…",
  // File
  "New Session": "新建会话",
  "Open Project...": "打开项目…",
  "New Window": "新建窗口",
  "Close Window": "关闭窗口",
  // Edit
  Undo: "撤销",
  Redo: "重做",
  Cut: "剪切",
  Copy: "复制",
  Paste: "粘贴",
  Delete: "删除",
  "Select All": "全选",
  // View
  "Toggle Sidebar": "切换侧边栏",
  "Toggle Terminal": "切换终端",
  "Toggle File Tree": "切换文件树",
  Reload: "重新加载",
  "Toggle Developer Tools": "切换开发者工具",
  "Actual Size": "实际大小",
  "Zoom In": "放大",
  "Zoom Out": "缩小",
  "Toggle Full Screen": "切换全屏",
  // Go
  Back: "后退",
  Forward: "前进",
  "Previous Session": "上一个会话",
  "Next Session": "下一个会话",
  "Previous Project": "上一个项目",
  "Next Project": "下一个项目",
  // Window
  Minimize: "最小化",
  Maximize: "最大化",
  // Help
  "OpenCode Documentation": "OpenCode 文档",
  "Report a Bug": "报告问题",
  "Share Feedback": "分享反馈",
  "Support Forum": "支持论坛",
}

const ZHT: Record<string, string> = {
  File: "檔案",
  Edit: "編輯",
  View: "檢視",
  Go: "前往",
  Window: "視窗",
  Help: "說明",
  "Check for Updates...": "檢查更新…",
  Settings: "設定",
  "Reload Webview": "重新載入頁面",
  Restart: "重新啟動",
  "Export Logs...": "匯出日誌…",
  "New Session": "新增工作階段",
  "Open Project...": "開啟專案…",
  "New Window": "新增視窗",
  "Close Window": "關閉視窗",
  Undo: "復原",
  Redo: "重做",
  Cut: "剪下",
  Copy: "複製",
  Paste: "貼上",
  Delete: "刪除",
  "Select All": "全選",
  "Toggle Sidebar": "切換側邊欄",
  "Toggle Terminal": "切換終端機",
  "Toggle File Tree": "切換檔案樹",
  Reload: "重新載入",
  "Toggle Developer Tools": "切換開發人員工具",
  "Actual Size": "實際大小",
  "Zoom In": "放大",
  "Zoom Out": "縮小",
  "Toggle Full Screen": "切換全螢幕",
  Back: "上一頁",
  Forward: "下一頁",
  "Previous Session": "上一個工作階段",
  "Next Session": "下一個工作階段",
  "Previous Project": "上一個專案",
  "Next Project": "下一個專案",
  Minimize: "最小化",
  Maximize: "最大化",
  "OpenCode Documentation": "OpenCode 文件",
  "Report a Bug": "回報問題",
  "Share Feedback": "分享意見",
  "Support Forum": "支援論壇",
}

const MENU_I18N: Record<string, Record<string, string>> = {
  zh: ZH,
  zht: ZHT,
}

/** 按当前 locale 翻译菜单英文标签;查不到的语言/标签原样返回英文。 */
export function translateMenuLabel(label: string, locale: string | undefined): string {
  if (!label || !locale) return label
  return MENU_I18N[locale]?.[label] ?? label
}
