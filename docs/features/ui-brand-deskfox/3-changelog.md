feat-id: ui-brand-deskfox
status: done
related: ./3-changelog.md

# ui-brand-deskfox — UI 残留 "OpenCode" 品牌字改 "DeskFox"

> 规模:Tiny(品牌文案修正,核心是一个 i18n 替换层 + 1 处硬编码)。
> 起源:2026-06-06 user 测试 2026.6.1 时发现更新检查 toast、设置界面多处仍显示 "OpenCode"。

## 改动

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/app/src/i18n/rebrand.ts` | **新增** | i18n 品牌替换层:把文案里的 "OpenCode" → "DeskFox",保留第三方服务名 "OpenCode Zen","OpenCode Desktop" 收敛为 "DeskFox";仅替换 value 不动 key |
| `packages/app/src/i18n/rebrand.test.ts` | **新增** | 6 个单测:普通替换 / Zen 保留 / Desktop 收敛 / 混排 / 小写 opencode 不动 / 只改 value |
| `packages/app/src/context/language.tsx` | +4 行(FORK) | 在仅有的两处 dict flatten 出口(`base` + `merge`)套 `rebrandDict` — 一处修全部 17 种语言,且自动覆盖未来上游新增的 "OpenCode" 文案 |
| `packages/app/src/pages/session/file-tabs.tsx` | 1 行(FORK) | Office 文件禁编辑提示里的硬编码 "OpenCode" → "DeskFox"(非 i18n,替换层管不到) |

## 为什么用替换层而非逐个改 17 个语言文件

逐个改 `i18n/*.ts` = 巨大上游 merge 冲突面 + 漏改风险。替换层符合 R1(新文件 + ≤5 行上游注入)/ R3(品牌不散落硬编码)/ P3(适配层穿过上游 i18n),上游升级零冲突。

## 覆盖范围

替换层捕获 i18n 里**全部** "OpenCode" 文案(不止 user 列出的 toast + 设置 4 行),包括:语言/外观/配色/主题描述、更新检查 toast、"已是最新版本" toast、provider 连接文案、MCP 错误提示、服务器切换描述、`app.name.desktop` 等。例外保留 "OpenCode Zen"(上游真实模型服务)。

## 回归测试

`bun test src/i18n/rebrand.test.ts`(6 pass)+ `bun run --cwd packages/app typecheck`(绿)。

## 回退

`git revert` 本 feat 的 commit;或删 `rebrand.ts` + 还原 `language.tsx` 两处注入即可。
