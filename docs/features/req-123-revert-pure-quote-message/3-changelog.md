feat-id: req-123-revert-pure-quote-message
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-123 · 实际改动

> commit:`d6a1aafb0f`(feat 分支 `feat/req-123-revert-pure-quote-message`)
> 规模:Medium · 净 +206 / −41(其中 i18n 回填 61 行) · **R4 override 0 笔**

## 一、一句话

经典布局(默认档)下**没有正文的用户消息**(聊天引用卡片 / 纯图片 / 纯附件)hover 不出撤回按钮 —— 动作条整条
被"有正文"这个条件挡掉;顺带让撤回**保真回填**:引用卡片跟着文本一起回到输入框,不再要求用户回去重新选一次文字。

## 二、改了什么

### 档一 — 动作条显示判定(session-ui)

| 文件 | 性质 | 行数 |
|---|---|---|
| `packages/session-ui/src/components/user-message-actions.ts` | **fork-only 新增** | +20 |
| `packages/session-ui/src/components/user-message-actions.test.ts` | **fork-only 新增(测试)** | +45 |
| `packages/session-ui/src/components/message-part.tsx` | 上游文件,2 处 FORK marker | +12 −1 |

判定从 `text() || (useV2Actions && comments>0)` 改为 `有正文 / 有可用动作 / (V2 && 有内联卡片)`。
复制按钮仍由内层 `<Show when={text()}>` 单独守着,不会出现"复制空消息"。

### 档二 — 撤回保真回填(app)

| 文件 | 性质 | 行数 |
|---|---|---|
| `packages/app/src/utils/prompt-comments.ts` | **fork-only 新增** | +68 |
| `packages/app/src/utils/prompt-comments.test.ts` | **fork-only 新增(测试)** | +175 |
| `packages/app/src/pages/session.tsx` | FORK marker,revert/restore 两侧注入 + 失败回滚 + toast | +36 −3 |
| `packages/app/src/utils/context-menu-host/host.tsx` | commentID 算法收口到共享 helper | +2 −6 |

- `extractCommentsFromParts` = `createCommentMetadata` 的逆函数,从 synthetic text part 的 metadata
  还原出 `FileContextItem`;老消息(无 metadata)退回 `parseCommentNote` 文本模板兜底;
  `origin: "review"` 的行评论不还原(归 review 面板管)。
- `session.tsx` 用 `prompt.context.replaceComments`(整体替换语义)在四个点收敛:
  revert 注入 / restore 换成下一条 / restore 到最新清空 / 请求失败还原快照。

### 顺带修 — ↑ 历史找回的聊天引用退化成文件卡片

`PromptHistoryComment` 缺 `kind`,且 legacy 与 v2 两个 composer 各写了一份等价的内联映射,两边一起漏。
收口成 `historyCommentToContextItem` 一处纯函数并补上 `kind`:

| 文件 | 行数 |
|---|---|
| `packages/app/src/components/prompt-input/history.ts` | +21 −2 |
| `packages/app/src/components/prompt-input.tsx` | +3 −12 |
| `packages/app/src/components/prompt-input-v2.tsx` | +7 −12 |
| `packages/app/src/components/prompt-input/history.test.ts` | +45 |

### i18n

新键 `session.revert.restoredToInput`:en / zh 写真文案,其余 60 个 locale 按 fork 既有先例回填英文
+ `// FORK-i18n-backfill(en 兜底)` 注释(`parity.test.ts` 要求 61 个 locale 键齐全)。

**顺带**:`da.ts` / `de.ts` / `no.ts` / `tr.ts` 四个文件末尾的 `} satisfies ...` 原先用 CR 与上一行相连
(上一批 backfill 留下的),本次脚本写回时规范化成 LF。**纯行尾变化,零文案改动**。

## 三、影响范围

- 用户可感:① 纯引用 / 纯图片 / 纯附件消息现在能撤回 ② 撤回后引用卡片留在输入框可直接续写
  ③ 撤回有 toast 说明内容去向 ④ ↑ 历史找回的聊天引用不再显示成 `<chat selection>` 文件卡。
- 不影响:有正文的消息(判定第一分支原样)、复制按钮条件、V2 布局既有分支、review 面板评论。

## 四、回归测试

| 项 | 结果 |
|---|---|
| 新增单测 | 20 例(session-ui 6 / app prompt-comments 11 / app history 3) |
| 红→绿双向验证 | 4 处反证全部按预期转红(2 / 1 / 3 / 2 条),还原后全绿 |
| `packages/app` `bun run test:unit` | **1069 pass / 0 fail**(138 文件) |
| `packages/session-ui` `bun test` | **114 pass / 0 fail** |
| fork 范围 typecheck | **29/29** |
| 真机 T17-T19(local 档,CDP 驱动) | **三条全过**,详见下方 §四之二 |

## 四之二、真机验收(2026-08-19,local 档 arm64,CDP 9333)

打 local 包(`OPENCODE_CHANNEL=local` + `electron-builder --mac --dir`)真机跑,**全程未碰 user 正在用的正式版**。

| 用例 | 实测 |
|---|---|
| **T17** 纯引用消息撤回 | 选中回复正文 → 右键「添加到聊天窗口」→ 卡片上写问题、输入框不写正文 → 发送。消息动作条**出现**(`user-message-copy-wrapper` 从 1 个变 2 个),里面**只有「撤销此消息」一个按钮、没有复制按钮**(没正文可复制,符合验收标准 1)。点撤回 → 时间线消息消失、引用卡片回到输入框、toast「已撤回,内容已回到输入框」。补一句正文 → 重发成功。 |
| **T18** 撤回→恢复不留重复卡片 | 回滚坞「恢复消息」后,输入框内容切换成**下一条**消息的内容(正文清空 + 该条的 1 张卡片),卡片数**始终 1 张、无累积**。另用一条更直接的对照:撤回一条**没有引用**的消息 → 卡片数 1 → 0(上一轮回填的卡片被 `replaceComments` 正确清掉),证明四点收敛真的生效。 |
| **T19** 正文 + 引用一起撤回 | 「补充一句:只要一句话结论」+ 引用卡片一起发出 → 无错误 toast、后端无伪路径报错(REQ-119 联动生效)→ 撤回 → **正文与卡片都回到输入框**。 |

### 真机顺带发现的既有缺陷(本次不修,已回填需求池)

**时间线里的聊天引用卡片显示成文件卡** —— 渲染出「文档图标 + `<chat selection>`」而不是「聊天引用」。
根因:`MessageComment`(`timeline/rows.ts`)类型只有 `path / comment / selection`,**没有 `kind`**,
`message-timeline.tsx:1238` 的 CommentStrip 直接 `FileIcon` + `getFilename(comment().path)` 渲染。
与本次改动无关(未触及该路径),是 chat selection 伪路径漏判的**第四例**
(前三例:2026-08-12 预览 tab、`keep-legacy-layout` 点开空白预览页、REQ-119 后端 execRead)——
需求池原文第七节"这条特性缺一次统一收口"再次被印证。

### 真机操作留下的会话状态(如实记录)

验收在 Finance 项目一条真实会话里做的(local 档与 sidecar 共用会话数据)。发出的 2 条测试消息
(「REQ-123 真机验收:这段什么意思」/「补充一句:只要一句话结论」)**均处于已撤回状态**:
不进模型上下文,回滚坞显示「2 条已回滚消息」,下次在该会话正常发消息时 `revert.cleanup` 会物理删除。
原始消息「帮我分析下科创 50 和创业板…」完好未动。

## 五、回退方法

单笔 revert 即可(P4)。三块彼此独立,也可分别撤:
- 只撤档一 → 还原 `message-part.tsx` 的 `<Show when={...}>` 条件 + 删 `user-message-actions.*`;
- 只撤档二 → 还原 `session.tsx` 的四处 `replaceComments` + 删 `prompt-comments.*`(host.tsx 的 ID 收口可留);
- 只撤历史修复 → 还原两个 composer 的内联映射(功能退回"找回的聊天引用显示成文件卡")。

## 六、已知未做(留 backlog,已写回需求池)

- 纯聊天引用**进不了 prompt 历史**(`historyComments()` 对无 selection 的 item 直接丢弃)——
  需求池原文第五章"↑ 键能找回"对聊天引用不成立;
- 时间线 CommentStrip 把聊天引用渲染成 `<chat selection>` 文件卡(见 §四之二,伪路径漏判第四例);
- 回滚坞升级(标题改写 / 「丢弃」按钮 / 预览文字修 `[附件]` 占位)、撤回措辞统一、`session.undo` 快捷键。
