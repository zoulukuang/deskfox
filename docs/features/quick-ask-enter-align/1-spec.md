feat-id: quick-ask-enter-align
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 「加入聊天」浮窗快捷键对齐主输入框(REQ-082)

> 需求源:`OPENCODE-PLAN/需求计划/2026-07-11-2.md`(REQ-082,🟢,纯前端)。
> 规模:Medium(纯前端,7 文件,新增 ~30 行含测试;单一主题)。

## 需求

选中文本后弹出的「加入聊天」浮窗,现在提交要按 `Cmd/Opt+Enter`(Win 用 `Ctrl+Enter`),与主聊天输入框(裸 `Enter` 提交)不一致 → 用户肌肉记忆冲突。对齐成:

- 裸 `Enter` 提交
- `Shift+Enter` 换行(交给 textarea 默认行为)
- IME 组合态守卫(`e.isComposing || e.keyCode === 229`)不误提交
- `Esc` 取消(保留不改)

## 落点(核对后)

有**两个**同款浮窗,必须一起改:

1. `packages/app/src/utils/context-menu-host/host.tsx`(context-menu-host,回调 `submitToChat`)—— fork-only 文件
2. `packages/app/src/pages/session/file-tabs.tsx`(markdown 选区入口,回调 `submitMdSelection`)—— 上游文件,保留 FORK marker

两处 onKeyDown 现为字节级完全相同(`if (!(e.ctrlKey || e.metaKey || (IS_MAC && e.altKey))) return`)。

## 两个已核约束

- `isImeComposing` 是 `prompt-input.tsx:602` 的组件内私有闭包(引用本地 `composing()` signal),**未导出、import 不到**。→ 新建共享纯函数 `isImeComposingEvent(e)` 放 `packages/app/src/utils/ime.ts`,两浮窗 + 未来复用。部分输入法只给 `keyCode 229` 不给 `isComposing`,故两者都判。
- 底部提示是 i18n 写死模板 `fileViewer.menu.input.shortcutHint` = `"{{shortcut}} 提交 · Esc 取消"`,只有一个 `{{shortcut}}` 槽。目标文案改不出来,必须改**模板串本身**(zh/zht/en 三 locale),并移除两浮窗调用处的 `shortcut` 传参。

## 验收标准

- [x] host.tsx 浮窗:裸 `Enter` → `submitToChat`;`Shift+Enter` → 换行不提交;IME 组合态 `Enter` → 不提交
- [x] file-tabs.tsx 浮窗:裸 `Enter` → `submitMdSelection`;`Shift+Enter` 换行;IME 组合态不提交
- [x] 两浮窗底部「提交」按钮点击仍能提交(键位改动别改坏按钮路径)
- [x] `Esc` 仍关闭浮窗
- [x] 底部提示文案已更新为 `Enter 提交 · Shift+Enter 换行 · Esc 取消`,zh/zht/en 三 locale 均已改模板串

## OUT OF SCOPE

- 主聊天输入框本身键位不动(它是对齐的参照系)。
- 浮窗 `Esc 取消` 语义、右键菜单项「添加到聊天窗口」标签、占位符文案均不改 —— 本需求是键位对齐,不是文案改版。
