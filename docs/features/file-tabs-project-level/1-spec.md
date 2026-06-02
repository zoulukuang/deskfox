feat-id: file-tabs-project-level
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 话题/文件查看器解耦 — 文件 tab 改项目级(REQ-042)

> 规模:Medium(改 tab 存储核心 + 单测,~60 行)
> 同分支:`feat/mirror-layout`(REQ-041 后续 commit,user 拍板不单独拆分支)
> 前置:REQ-041(`024518ae0` / `4c3613b1e`)

## 一、需求

现状:文件查看器的 tab 按 **`项目/会话ID`** 存(`store.sessionTabs[sessionKey]`),每个会话(话题)一套独立文件 tab,**切话题就换整套 tab**(新话题空白)。这是上游 opencode 的开发者 IDE 假设(一任务一套文件)。

DeskFox 定位白领/文档工具:文件查看器是**工作台**,切换 AI 对话(话题)时正在看的文档不该消失。需要**解耦**:切话题不影响文件查看区既有标签。

## 二、决策(user 拍板)

1. **文件 tab → 项目级共享**:同项目所有会话共享一套文件 tab,切话题不变,切项目才换。(粒度:项目级,非全局)
2. **"审查/上下文" tab 内容仍会话级**:它们是某会话的产物(审查=该会话 diff / 上下文=该会话 token);标签位置不随会话跳,但内容由 session 层按会话提供。
3. **active 始终保持**:切会话时文件查看器显示的标签纹丝不动(最纯粹解耦)。
4. **底层绑定不强留**:OpenCode 原"会话记得它看过哪些文档"的绑定,经审计**只驱动 UI tab + 一个内存选区记录**,无 AI 上下文/无持久化现场恢复消费者。按元原则(稳定>简洁、避免为假想需求铺摊子),**不为它单独维护并行 per-session tab 状态**;真要"现场恢复"再说(选区轻记录 handoff 已天然存在)。

## 三、实现

- 新增 `store.projectTabs[dir]`(项目级,独立于按会话 prune 的 `sessionTabs`)。
- `layout.tabs()` 的存储 key 从 sessionKey 改 `projectTabKey(sessionKey)`(= dir 段)。`open/close/setActive/setAll/move` 全切到 projectTabs。
- `projectTabKey` 提到零依赖纯文件 `context/session-key.ts`(可单测)。
- 旧 `sessionTabs`(会话级)不再写入,自然废弃(顶多让用户重开一次文件,不迁移)。
- 边界:active="审查" 切到无 diff 会话 → 落到 reviewPanel"暂无更改"空状态(不崩),可接受。

## 四、R8 测试用例清单

| # | 用例 | 层级 | 预期 | 手段 |
|---|---|---|---|---|
| T1 | typecheck | 结构 | 17/17 pass | `bun run typecheck` ✅ |
| T2 | projectTabKey 单测 | Logic | 同项目同 key / 切项目不同 key / 无 id 兜底 / 空串兜底 | `session-key.test.ts` 6 pass ✅ |
| T3 | 既有单测无回归 | 结构 | packages/app 全绿 | `bun test` |
| T4 | Phase 1 e2e 无回归 | 结构 | 14 passed(聊天循环不受 tab 存储改动影响) | playwright ✅ |
| T5 | release build + 启动 | 运行时·native | DeskFox.exe 启动正常 | build-deskfox.ps1 |
| T6 ⚠ | 切话题文件 tab 保持 | 交互·native | 会话A 打开文档1/2 → 切会话B → 文档1/2 标签仍在、active 不变 | 真桌面 |
| T7 ⚠ | 切项目换 tab | 交互·native | 切到另一项目 → 文件 tab 换成该项目的 | 真桌面 |
| T8 ⚠ | 审查仍跟会话 | 交互·native | 切会话,"审查"tab 内容是当前会话的 diff | 真桌面 |

⚠ = 真桌面 QA。

## 五、退出
T1–T5 结构验证 + user 真桌面 QA(T6–T8);或 user 改主意(则回退本 commit,REQ-041 不受影响)。
