feat-id: popup-enter-passthrough
status: done
related: ./3-changelog.md

# REQ-085 「加入聊天」浮层 Enter 穿透触发文件预览区开关 — 修复记录(Tiny)

**现象**:聊天区选中文字右键「加入聊天」浮层内按 Enter,文件预览区被 toggle(Win/Mac 双端,2026-07-14 user 确认)。

**根因(比需求池假设更具体)**:`use-file-tree-shortcuts.ts` 的 window 级 keydown B 路径(焦点在
中性区 + 文件树 selection 非空 → 裸 Enter 当文件树导航「打开文件」)。浮层 textarea 的元素级
handler 提交后**同步卸载浮层** → `document.activeElement` 瞬间回落 body;同一事件继续冒泡到
window 监听时 `activeIsEditable()` 已误判中性区 → B 路径放行 → Enter 被当导航键打开文件/toggle
预览。这也解释了复现前提「之前点过文件树(selection 非空)」。REQ-082 在 file-tabs 的
`reviewPanel.open()` 兜底是同症状创可贴,根因在此。

**修法**:新增守卫 `keyEventFromEditableOutsideTree(event.target)` — 用**事件原始 target**(即使
节点已 detach 也不变)判定:文件树之外的 INPUT/TEXTAREA/SELECT/contentEditable 一律不接管;
文件树内部(重命名 input 自带 stopPropagation)保持原 A 路径行为。

**commit**:见本分支(fix + bug-repro 测试同笔,`[bug-repro]` 标)。
**测试**:use-file-tree-shortcuts.test.ts 4 用例(detached-textarea 主线复现 / 三类可编辑控件 /
树内豁免 / 空 target);app typecheck 0 错。
**回退**:整笔 revert;或删守卫两行恢复旧行为。
**遗留**:REQ-082 的 `view().reviewPanel.open()` 兜底(file-tabs.tsx)可在下批验证后回收,本笔不动(稳定优先)。
