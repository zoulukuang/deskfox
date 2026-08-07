feat-id: session-list-ux
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-096 会话列表操作体验 — 1-spec

> 源:OPENCode-PLAN `需求池/会话列表操作体验.md`(2026-08-07 PM 讨论定稿,user 拍板)。

## 需求

1. **标题编辑失焦保存**:session 标题编辑态(双击标题或 ⋯ 菜单重命名进入)blur = 保存;Enter = 保存;Esc = 显式放弃;清空后提交 = 恢复原名。现状 blur 丢弃(`message-timeline.tsx:1400 onBlur={closeTitleEditor}`)。侧栏工作区重命名(`layout/inline-editor.tsx:103`)同病,顺带同修保持一致。
2. **侧栏会话行右键菜单**(新增,应用层):重命名 / 分享 / 归档 / 删除。参照 `sidebar-project.tsx` 的 Kobalte ContextMenu 先例(已 i18n)。接管后原 Electron 原生 "Copy Link" 英文菜单在会话行不再出现(i18n 问题就地消解;其他区域原生菜单 i18n 列 follow-up 不在本期)。
   - 重命名 → 列表行**原地 inline 编辑**(blur/Enter 保存,Esc 放弃,规则同 1)
   - 分享 → 执行 share 并复制链接 + toast「链接已复制」(完整分享管理仍在会话头部 ⋯ 菜单 popover)
   - 归档 → 复用现有 archiveSession + 撤销 toast(见 3)
   - 删除 → 复用现有 DialogDeleteSession 确认框
3. **归档防误触**:删除会话行 hover 归档图标(`sidebar-items.tsx:248-272`);归档动作收进右键菜单;归档成功弹 toast「已归档,可在搜索中找到 [撤销]」,撤销 = 取消归档并回列表。事后救优于事前拦(user 拍板方向)。
4. **取消归档 API 补齐**(sidecar 小扩展,undo 的前置):HTTP `session.update` 的 `time.archived` 接受 `null` = 清除归档(schema `NullOr` + handler `?? undefined` 透传现成 `setArchived` 清除语义)+ SDK regen。现状 HTTP 无法取消归档。

## 不做

- 全局 Electron 原生菜单(图片/链接等)i18n — follow-up 另立
- 会话行菜单「复制链接」项(原生 Copy Link 复制的是内部路由,无用户价值;分享=复制公开链接已覆盖)
- 归档会话的专门列表视图(找回走 ⌘K 搜索,REQ-095 已支持)

## R8 测试用例清单

Unit(Logic):
- [ ] U1 标题保存规则纯函数/流程:blur 保存、Enter 保存、Esc 放弃、空串恢复原名、与原名相同不发请求
- [ ] U2 undo 流程:归档 → store 移除 + toast;撤销 → update(archived:null) + store 回插(顺序保持)
- [ ] U3 sidecar UpdatePayload:archived:null 解码通过且 handler 走清除;数字正常归档;omit 不动(集成测试,真 SQLite)

e2e(mock server):
- [ ] E1 标题编辑输入后点击其他区域 → 标题保存(update 请求发出 + UI 展示新标题)
- [ ] E2 Esc 放弃、清空失焦恢复原名
- [ ] E3 会话行右键 → 菜单出现(中文 locale 下中文文案)→ 重命名 → 行内输入 → blur 保存
- [ ] E4 右键归档 → 行消失 + 撤销 toast → 点撤销 → 行回来
- [ ] E5 右键删除 → 确认框出现;右键分享 → share 请求 + 复制 toast
- [ ] E6 会话行 hover 无归档图标

真机(CDP,本地版):
- [ ] M1 逐项界面实测:标题 blur 保存 / 右键四项菜单中文 / inline 重命名 / 归档+撤销全链路

## 验收标准

- [ ] 标题编辑失焦不再丢内容;Esc 仍可显式放弃
- [ ] 会话行右键菜单四项可用且跟随软件语言
- [ ] 行 hover 无归档图标;归档误触可一键撤销
- [ ] 撤销后会话回到列表原位,归档状态清除(重启后仍在列表)
