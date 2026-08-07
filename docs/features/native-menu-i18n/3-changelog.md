feat-id: native-menu-i18n
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 原生右键菜单 i18n — 3-changelog

> 2026-08-07 交付。commit hash 回填见尾注。0 R4。

## 改动

- 新增 fork-only:`packages/desktop/src/main/deskfox/context-menu-labels.ts`(19 语言 × 12 标签 + locale 归一)、`context-menu.ts`(按语言重挂管理)、`context-menu-labels.test.ts`(4 用例 229 断言:全语言完整性/zh 抽查/归一边界/未知回退)
- 上游 FORK:`main/index.ts` contextMenu 初始化换 `applyContextMenuLanguage()`(OS locale 兜底);`deskfox/ipc.ts` 注册 `set_context_menu_language`;`app/src/context/language.tsx` 语言 effect 同步到 main(桌面端才发)

## 验证

- desktop 166 单测全绿(含新 4);app 596 全绿;desktop/app typecheck 绿
- 真机:IPC 调用返回 true;cliclick 真实右键 composer + screencapture 实拍 —— 原生菜单显示中文「剪切/复制/粘贴」(app 语言 zh,跟随设置非 OS)

## 备注

- 会话行右键菜单(REQ-096)是应用层菜单,本 feat 覆盖其余原生菜单场景(输入框/图片/链接)。
- 语言切换即时生效(重挂),无需重启。

## 2-plan

(Medium 简版,决策已在 1-spec;无踩坑)

## commit

- 主体:(回填)
