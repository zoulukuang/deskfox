// FORK-ONLY: i18n 品牌替换层 [feat: ui-brand-deskfox] 2026-06-06
//
// 上游 i18n 文案(及 @opencode-ai/ui 包)散落大量 "OpenCode" 品牌字。逐个改 17 种语言文件
// = 巨大上游 merge 冲突面 + 漏改风险。改为在 language.tsx 的 dict flatten 出口统一过一道替换:
// 一处修全部语言,且自动覆盖未来上游新增的 "OpenCode" 文案。
//
// 例外规则(短语保留 + key 命名空间豁免,唯一事实源见需求
//  OPENCODE-PLAN/需求池/electron-DeskFox品牌残留-接线补齐.md §五):
// - 短语保留(任意 key):"OpenCode Zen" / "OpenCode Go" —— 上游官方产品/服务专名(不是我们的品牌),原样保留。
// - "OpenCode Desktop" 收敛为 "DeskFox"(产品名就叫 DeskFox,不带 Desktop 后缀)。
// - key 命名空间豁免(整条 value 不替换,保留 OpenCode):
//   · wsl.*(含 settings.desktop.wsl.*)—— "OpenCode" = WSL 内真实 `opencode` CLI 二进制/安装命令名。
//   · error.chain.mcpFailed —— 研发向 + 技术准确。
//   · dialog.model.unpaid.freeModels.title —— "Free models provided by OpenCode" 是提供方归属。
// 仅替换文案 value,绝不动 key —— key 里的 "opencode"(如 dialog.provider.opencode.note)是
// 翻译查找用的标识符,改了会断掉翻译。小写 "opencode"(URL scheme / 包名)不在替换范围。
// 注:菜单 "OpenCode Documentation"(desktop-menu.ts 的硬编码 label)不走本替换层,天然保留,无需在此豁免。

const BRAND = "DeskFox"

/**
 * key 命名空间豁免判定:命中则该条 value 整体保留(不替换 OpenCode)。
 * 接受已扁平化的点分 key(如 "settings.desktop.wsl.description")。
 */
export function isRebrandExemptKey(key: string): boolean {
  // wsl.* 任意层级(顶层 wsl.x 或嵌套 settings.desktop.wsl.x)
  if (/(^|\.)wsl\./.test(key)) return true
  if (key === "error.chain.mcpFailed") return true
  if (key === "dialog.model.unpaid.freeModels.title") return true
  return false
}

/** 替换单条文案里的 "OpenCode" 品牌字;保留 "OpenCode Zen" / "OpenCode Go"(官方专名)。 */
export function rebrandValue(value: string): string {
  if (typeof value !== "string") return value
  return value
    // 先收敛 "OpenCode Desktop" → "DeskFox"(否则下一步会得到 "DeskFox Desktop")
    .replace(/OpenCode Desktop/g, BRAND)
    // 其余 "OpenCode" → "DeskFox",但 "OpenCode Zen" / "OpenCode Go" 后缀豁免
    .replace(/OpenCode(?! Zen| Go)/g, BRAND)
}

/**
 * 对扁平化后的字典整体做品牌替换(仅 value,保持 key 与类型不变)。
 * key 命中 isRebrandExemptKey 的整条 value 原样保留。
 */
export function rebrandDict<T extends Record<string, string>>(dict: T): T {
  const out: Record<string, string> = {}
  for (const key in dict) {
    out[key] = isRebrandExemptKey(key) ? dict[key] : rebrandValue(dict[key])
  }
  return out as T
}
