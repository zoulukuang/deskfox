feat-id: req-123-revert-pure-quote-message
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-123 · 实施计划 + 决策轨迹

## 一、动工前的可行性核查(2026-08-19)

REQ-119 刚合入 main(`b7148a8def`),而本需求与它同一片代码,先逐条复核需求池原文的源码定位是否还成立:

| 检查项 | 结论 |
|---|---|
| `message-part.tsx:1269` 的窄条件 | ✅ 原封不动,主因成立 |
| 经典布局清空 comments(`message-timeline.tsx:1270`)+ `CommentStrip`(`rows.ts:157`) | ✅ 成立 |
| `createCommentMetadata` 的字段完整性(档二数据前提) | ✅ REQ-119 没动它,六个字段照旧写进 metadata |
| 「还原伪路径会不会又喂给后端」 | ✅ **顾虑已解除** —— REQ-119 的 `isChatQuote` 让 `kind==="chat"` 永不产 file part |
| R4 配额 | ✅ 触点全在 `packages/app/` + `packages/session-ui/`,均不在 `.husky/pre-commit:17` 黑名单 → **0 笔** |

核查中同时发现需求池原文的**四处不精确**(已写进 1-spec §三),其中影响实现路径的是第 1、2 条:
`extractPromptFromParts` 装不下 context item,以及 restore 侧必须对称处理。

## 二、决策轨迹

### D1 — 档一走 helper extract,不在 JSX 里堆条件

session-ui 没有组件渲染测试设施(现有测试全是纯 logic),而 R5 双清单要求 Logic 侧有单测。
故把判定抽成 fork-only 的 `user-message-actions.ts` 纯函数,组件里只留一次调用 —— 既满足 R1 三级跳
(新文件 + 上游少量注入),也让四种输入组合能被单测锁住。

### D2 — 还原用 `replaceComments` 而不是逐条 `add`

`prompt.context.replaceComments` 是**整体替换**语义(清掉现有 comment item 再放新的),
天然满足"撤回=用这条消息的内容替换输入框"的心智,也让 revert / restore 两侧对称:
- revert:`replaceComments(这条消息的卡片)`
- restore(有下一条):`replaceComments(下一条消息的卡片)`
- restore(没有下一条,即恢复到最新):`replaceComments([])`
- 请求失败:`replaceComments(操作前的快照)`

逐条 `add` 做不到最后两种收敛,会留下重复卡片。

### D3 — commentID 后缀改用 part.id(而非需求池说的"同算法重新哈希")

原算法后缀是 `Date.now()`,复现不了也不需要复现(它只是前端 dedup key)。
改用 part.id:同一条消息反复撤回得到同一个 ID(幂等),同一消息内两条引用又互不相同。
hash 部分保持与 `host.tsx` 一致 —— 聊天引用没有行号,`contextItemKey` 光靠 `path:start:end`
会把同源多次选区 dedup 成一条,必须靠 preview 的 hash 拉开(这是 2026-05-25 就踩过的坑,注释还在)。
顺手把算法从 `host.tsx` 收口到 `utils/prompt-comments.ts`,两处共用一份。

### D4 — `origin: "review"` 不还原

review 行评论归 review 面板管(`prompt-input.tsx` 的 `openComment` 会按 origin 决定跳面板还是跳文件),
撤回时把它塞回输入框会与面板状态打架。只还原用户在 prompt 里加的卡片(quote / file)。
缺省 origin 按 `"quote"` 还原而不是留 `undefined` —— `undefined` 会让点开卡片的逻辑去猜 review。

### D5 — 顺带修的 kind 丢失,以及**不修**的历史缺口

施工中发现 `PromptHistoryComment` 没有 `kind`,legacy 与 v2 两个 composer 各写了一份等价的内联映射,
`kind` 在两边一起漏 → ↑ 历史找回的聊天引用退化成文件卡片。修法是把映射收口成 `historyCommentToContextItem`
一处纯函数(顺带消掉重复),3 行补上 kind。

但**更深的一条不修**:纯聊天引用**根本进不了 prompt 历史** —— `historyComments()` 对无 selection 的 item
直接 `return []`,而聊天引用卡片没有 selection。这意味着需求池原文第五章"前提 2:↑ 键回溯能带回来"
**对聊天引用不成立**,那条"丢弃时 toast 写『按 ↑ 可找回』"是错误承诺(所幸本次范围不含它)。
放宽它要动 history 类型 / 序列化 / 回填三处,超出本次范围 → 回填需求池留 backlog。

**这条反过来抬高了档二的分量**:撤回后,消息 part 里的 metadata 是聊天引用**唯一**的找回路径。

### D6 — i18n 新键沿用 fork 既有的 en 兜底先例

`parity.test.ts` 强制 61 个 locale 必须有每个 en 键(加一个键就红一次)。
fork 既有做法是非 zh 语言填英文原文 + `// FORK-i18n-backfill(en 兜底)` 注释(如 `dialog.provider.getbot.tagline`),
本次照做:en + zh 写真文案,其余 60 个回填英文。

## 三、验证记录

| 项 | 结果 |
|---|---|
| 新增单测 | session-ui 6 例(T1-T6)/ app prompt-comments 11 例(T7-T13)/ app history 3 例(T14) |
| 红→绿双向验证 | 4 处反证:去掉 canRevert 分支 → 2 红;不跳过 review → 1 红;还原不带 kind → 3 红;历史映射不带 kind → 2 红;还原后全绿 |
| app `bun run test:unit` | 1069 pass / 0 fail(138 文件) |
| session-ui `bun test` | 114 pass / 0 fail |
| fork 范围 typecheck | 29/29 |
| 真机(T17-T19) | local 档真机 CDP 三条全过,见 3-changelog §四 |
