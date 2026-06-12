// FORK-ONLY: i18n 品牌替换层 [feat: ui-brand-deskfox] 2026-06-06
//
// 上游 i18n 文案(及 @opencode-ai/ui 包)散落大量 "OpenCode" 品牌字。逐个改 17 种语言文件
// = 巨大上游 merge 冲突面 + 漏改风险。改为在 language.tsx 的 dict flatten 出口统一过一道替换:
// 一处修全部语言,且自动覆盖未来上游新增的 "OpenCode" 文案。
//
// 例外规则:
// - "OpenCode Zen" 是上游真实的第三方模型服务名(不是我们的品牌),保留原样。
// - "OpenCode Desktop" 收敛为 "DeskFox"(产品名就叫 DeskFox,不带 Desktop 后缀)。
// 仅替换文案 value,绝不动 key —— key 里的 "opencode"(如 dialog.provider.opencode.note)是
// 翻译查找用的标识符,改了会断掉翻译。小写 "opencode"(URL scheme / 包名)不在替换范围。

const BRAND = "DeskFox"

/** 替换单条文案里的 "OpenCode" 品牌字;保留 "OpenCode Zen"(第三方服务名)。 */
export function rebrandValue(value: string): string {
  if (typeof value !== "string") return value
  return value
    // 先收敛 "OpenCode Desktop" → "DeskFox"(否则下一步会得到 "DeskFox Desktop")
    .replace(/OpenCode Desktop/g, BRAND)
    // 其余 "OpenCode" → "DeskFox",但 "OpenCode Zen" 后缀豁免
    .replace(/OpenCode(?! Zen)/g, BRAND)
}

/** 对扁平化后的字典整体做品牌替换(仅 value,保持 key 与类型不变)。 */
export function rebrandDict<T extends Record<string, string>>(dict: T): T {
  const out: Record<string, string> = {}
  for (const key in dict) {
    out[key] = rebrandValue(dict[key])
  }
  return out as T
}
