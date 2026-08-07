feat-id: session-list-ux
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-096 会话列表操作体验 — 2-plan

## 实施顺序

1. sidecar:UpdatePayload `archived: NullOr` + handler `?? undefined`(2 处 FORK 行)+ SDK regen + 集成测试(U3)
2. 标题 blur 保存(message-timeline.tsx + layout/inline-editor.tsx 各 1 行改向)
3. 会话行右键菜单(sidebar-items.tsx,照 sidebar-project.tsx Kobalte ContextMenu 先例)+ i18n 键复用/新增
4. inline 重命名(行内编辑态)
5. 归档图标移除 + archiveSession 撤销 toast(file-tree showMoveUndoToast 先例)
6. e2e + 真机 CDP

## 关键决策

- **D1 undo 需要 HTTP 取消归档**:核实 `UpdatedTime.archived` 会话服务层本就支持清除(`setArchived` 省略 time → patch spread undefined → `optionalOmitUndefined` 落库为清除),缺口只在 HTTP 层(UpdatePayload 无 null + handler 挡 undefined)→ 最小补齐 2 行 + regen,R4 一笔(commit 前出复核报告)。
- **D2 右键菜单不复用头部 ⋯ 菜单组件**:两处宿主不同(DropdownMenu vs ContextMenu)、重命名语义不同(头部改标题编辑器 vs 行内 inline),强行同源反而绕;对齐的是**动作集与文案 key**,各自薄壳。
- **D3 会话行分享 = share+复制链接**:单向快捷路径;unshare 等完整管理留在头部 popover,不做两套状态管理。
- **D4 撤销回插**:archiveSession 已 splice + 可能导航走;undo = update(archived:null) + 把暂存的 session 对象按原序插回 store(Binary.search 定位),不整表刷新。

## 踩坑记录(开发中实时追加)

- (待补)
