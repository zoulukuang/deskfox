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

## 回退方法
`git revert <本笔 commit>` 回到会话级文件 tab;REQ-041(布局)不受影响,正交。

## 遗留 backlog
- 旧会话级 sessionTabs 持久化数据清理(本次留存无害,占用极小)。
- active="审查" 切无 diff 会话显示"暂无更改"空状态,若 QA 觉突兀可在 helpers.activeTab 加 hasReview fallback(注意 loading 闪烁,见 2-plan note 3)。
