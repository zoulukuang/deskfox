feat-id: quick-ask-enter-align
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 「加入聊天」浮窗快捷键对齐

## 实际改动

commit: feat 分支 `feat/quick-ask-align-onboarding`,与 REQ-083 同分支分开 commit;反查 `git log --grep '[feat: quick-ask-enter-align]'`(合 main 后回填最终 hash)

| 文件 | 改动 | 类型 |
|---|---|---|
| `packages/app/src/utils/ime.ts` | 新增 `isImeComposingEvent(e)` 共享纯函数(`e.isComposing || e.keyCode === 229`)| 新增 fork-only |
| `packages/app/src/utils/ime.test.ts` | 4 单测(isComposing / keyCode 229 / 裸 Enter / 两者同命中)| 新增 fork-only |
| `packages/app/src/utils/context-menu-host/host.tsx` | onKeyDown 改裸 Enter 提交 + Shift+Enter 换行 + IME 守卫;移除 `shortcut` 传参;删无用 `IS_MAC` | 改 fork-only |
| `packages/app/src/pages/session/file-tabs.tsx` | 同上(markdown 选区浮窗);保留 FORK marker;删无用 `IS_MAC` | 改上游 |
| `packages/app/src/i18n/zh.ts` | `shortcutHint` → `Enter 提交 · Shift+Enter 换行 · Esc 取消` | 改 |
| `packages/app/src/i18n/zht.ts` | `shortcutHint` → `Enter 提交 · Shift+Enter 換行 · Esc 取消` | 改 |
| `packages/app/src/i18n/en.ts` | `shortcutHint` → `Enter to submit · Shift+Enter for newline · Esc to cancel` | 改 |

行数:约 +50 −12。上游侵入:1 文件(`file-tabs.tsx`,已有 FORK marker,本次续用)。

## 影响范围

- 选区「加入聊天」两个入口(PDF/Office 右键浮窗 + markdown 选区浮窗)提交键位。
- 其余 locale(ar/de/fr/ja/... 等 16 个)无 `shortcutHint` key,回落英文默认,不受影响。

## 回归测试

- `bun test src/utils/ime.test.ts` → 4 pass
- `bun turbo typecheck --filter=./packages/app` → 绿

## 回退方法

`git revert <commit>` 单笔回退(纯前端,P4 可逆)。

## 真桌面 QA 记录

### ✅ file-tabs.tsx 浮窗(markdown 选区)CDP 验证全过(2026-07-13,本地版隔离首启)

本地版打开介绍文档 md → CDP 选区触发浮窗 → 派发键盘事件(IME 组合态用 `Object.defineProperty` 强制 `keyCode=229`/`isComposing`)→ 观测浮窗 `[data-slot=md-selection-menu]` 存亡:

- ✅ 底部文案 = `Enter 提交 · Shift+Enter 换行 · Esc 取消`
- ✅ 裸 Enter → 提交(浮窗消失)
- ✅ Shift+Enter → 换行不提交(浮窗仍在,textarea 值保留)
- ✅ IME `keyCode=229` Enter → 不提交
- ✅ IME `isComposing` Enter → 不提交
- ✅ Esc → 关闭
- ✅ 提交按钮点击 → 提交(键位改动未破坏按钮路径)

### host.tsx 浮窗(PDF/Office 右键)

onKeyDown 与 file-tabs.tsx **字节级一致**(共用 `isImeComposingEvent` + 同一 i18n `shortcutHint`),由上面 file-tabs CDP 验证 + `ime.test.ts` 单测覆盖同一逻辑。PDF/Office 右键触发的**真机视觉**留人工确认(需 PDF/office 文件,New DeskFox 仅 md)。

### 仍建议真机点验

- 真中文输入法(非合成事件)组合确认时 Enter 不误提交(CDP 用 defineProperty 模拟,真输入法更权威)。
- host.tsx PDF/Office 右键浮窗视觉。

## Follow-up:提交后保持文件预览打开(2026-07-14,真机验证)

user 真机反馈:markdown 选区浮窗裸 Enter 提交后**文件预览被关闭**(键位改动前 Cmd/Opt+Enter 提交也是同副作用,裸 Enter 后更易触发才暴露)。CDP(含 `Input.dispatchKeyEvent` 真实键盘注入)在默认宽窗下**复现不出**(提交后文档内容仍在、active 仍是介绍文档),判断与真机窄窗布局「加 context 后聊天区展开挤掉预览」相关。

- **修法**(`file-tabs.tsx` `submitMdSelection`):提交后的 `requestAnimationFrame` 里,`focusChatInput()` 之后主动 `view().reviewPanel.open()` + `tabs().setActive(props.tab)` —— 保持文件预览打开 + 当前文件 active。已开则 no-op,安全兜底。
- **验证**:user 真机测试通过(提交后预览保持)。
- 标 `[bug-repro: 浮窗 Enter 提交后文件预览关闭]`;纯 UI 布局兜底,CDP 复现不出故无自动化复现测试。
