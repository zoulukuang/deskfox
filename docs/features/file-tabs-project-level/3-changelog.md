feat-id: file-tabs-project-level
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 3-changelog — 实际改动

## 改动概览
文件查看器 tab 从「会话级」(`store.sessionTabs[项目/会话ID]`)解耦为「项目级」(`store.projectTabs[项目]`):切话题不影响既有文件标签,切项目才换。审查/上下文 tab 内容仍由 session 层按会话提供。纯前端 / 0 改后端。

## 文件级改动(3 文件)

| 文件 | 改动 |
|---|---|
| `context/session-key.ts`(新建) | 零依赖纯函数 `projectTabKey(sessionKey)= dir 段`(便于单测) |
| `context/session-key.test.ts`(新建) | 6 单测锁定项目级共享语义(同项目同 key / 切项目换 key / 无 id 兜底 / 空串兜底) |
| `context/layout.tsx` | 加 `store.projectTabs[dir]`;`tabs()` 全方法(tabs/active/all/setActive/setAll/open/close/move)存储 key 从 sessionKey 改 `projectTabKey()`;import projectTabKey。旧 sessionTabs 不再写入(prune/migrate 保留但无害) |

## 验证
- **T1 typecheck**:pass ✅
- **T2 projectTabKey 单测**:6 pass / 0 fail ✅
- **T3 既有单测无回归**:786 pass / 0 fail ✅(780 + 6 新增 projectTabKey)
- **T4 Phase 1 e2e**:14 passed / 3 skipped ✅(tab 存储改动不影响聊天循环)
- **T5 release build**:DeskFox.exe 产出 + 启动正常 ✅
- **T6–T8 交互·native**:**待 user 真桌面 QA**(切话题 tab 保持 / 切项目换 / 审查跟会话 / 关重开按项目记住)

## commit
grep `[feat: file-tabs-project-level]`(REQ-041 后续,feat/mirror-layout 分支独立一笔)

## code review 修复(high-effort 7-finder 审查后,合 main 前)
7 路 finder 审出 tab-store 重构的生命周期问题,修了 3 个:
- **#1 handoff 死代码 + 地雷**(`session.tsx` / `submit.ts` / `layout.tsx`):解耦后 workspaceTabs(key=dir)与 tabs()(key=dir/id)都解析到同一 `projectTabs[dir]`,新会话继承 tab 的 handoff 拷贝/清空成死代码,且清空分支会误抹项目共享 tab。**整套删除**(session.tsx handoff effect + submit.ts setTabs + layout.tsx layout.handoff/TabHandoff)。
- **#2 关项目不删 → 重加复活坏标签**(`layout.tsx` `projects.close`):移除项目时没删 `projectTabs[dir]`,重新添加同目录会复活旧/坏标签。`close()` 加按 `base64Encode(dir)` 删。(projectTabs 天然受项目数约束 + close 清理 → 不需额外 LRU。)
- **#3 切会话 active/上下文串味**(`layout.tsx` tabs() / `session-key.ts`):active 指针 + "上下文"伪标签原是项目级 → 同项目两会话共享 active、串味。**拆分**:文件 tab + 文件 active 仍项目级(`projectTabs`);"审查/上下文"的 active + context-open 改存会话级 `sessionView[sessionKey].tab`(`SessionPseudoTab`)。合成逻辑提纯函数 `synthTabs`(session-key.ts)+ 4 单测。对外 `{ all, active }` 形状不变,helpers/session-side-panel 零改。

验证:typecheck + 790 单测(含 synthTabs 4 + projectTabKey 6)+ e2e 14 全过。

## 回退方法
`git revert <本笔 commit>` 回到会话级文件 tab;REQ-041(布局)不受影响,正交。

## 遗留 backlog
- 死 `sessionTabs` 的 migrate/prune 空转清理(完全无写入,留存无害,占用极小;避免动持久化迁移逻辑故留 backlog)。
- active="审查" 切无 diff 会话显示"暂无更改"空状态(已 fallback 不崩),若 QA 觉突兀可在 helpers.activeTab 加 hasReview fallback(注意 loading 闪烁,见 2-plan note 3)。
