feat-id: req-123-revert-pure-quote-message
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# REQ-123 · 纯引用消息没有撤回按钮 + 撤回不保真 — 需求 + 验收

> 需求池原文:`OPENCODE-PLAN/需求池/纯引用消息没有撤回按钮.md`(2026-08-19 立项,P2)
> 实施:2026-08-19 · 规模 Medium · **范围经 user 拍板 = 档一 + 档二 + 最小 toast**

## 一、问题(两条,同一入口)

在聊天区选中文字 →「添加到聊天」→ 不另写正文直接发送,这条用户消息在时间线上只有一张引用卡片:

1. **撤回按钮不出现**(hover 也没有),整条动作条(Agent · 模型 · 时间 + 撤回 + 复制)都不渲染;
2. 就算绕行命令面板 `/undo` 撤回了,**引用卡片不会回到输入框** —— 用户必须回去重新选一次文字。

## 二、根因(读现码确认,2026-08-19 复核 REQ-119 合入后仍成立)

### 主因:动作条整条被 `text()` 守卫挡掉

`packages/session-ui/src/components/message-part.tsx:1269`:

```tsx
<Show when={text() || (props.useV2Actions && messageComments().length > 0)}>
```

- 聊天引用发出后是一条 **synthetic text part**(带 comment metadata),`text()` 只认非 synthetic 的 text part;
- **经典布局**(默认档)下 `messageComments()` 被显式清空(`message-timeline.tsx:1270` 返回 `[]`),卡片改由独立的
  `CommentStrip` 行渲染(`timeline/rows.ts:157`);
- 两边都假 → 动作条不渲染。`props.actions?.revert` 本身一路传到位,是**渲染条件写窄了,不是能力缺失**。

影响面:经典布局下**任何"没有正文"的用户消息**都撤不回(纯图片 / 纯附件同理)。

### 附带:撤回回填只带文本流,不带引用卡片

`session.tsx:1954` 的 `prompt.set(draft(messageID))` 只写 `Prompt`(= `ContentPart[]`,纯文本流);
引用卡片是**另一块状态** `prompt.context.items`(`FileContextItem`),回填时无人写入 → 卡片丢失。

## 三、本次立项时相对需求池原文的四处修正(均已读码验证)

1. **`extractPromptFromParts` 装不下 context item** —— 它返回 `Prompt`(文本流),`FileContextItem` 不在其中。
   故档二**不能**"在 extractPromptFromParts 里还原"了事,须单独出一个提取函数,由 `session.tsx` 调
   `prompt.context.replaceComments(...)` 写入。
2. **`restore` 路径必须对称处理** —— `restoreMutation`(`session.tsx:1982`)会把下一条消息的 draft 塞回输入框;
   只在 revert 侧注入而 restore 侧不清,撤回→恢复后输入框会**残留一张重复卡片**(新 bug)。
   `replaceComments`(整体替换语义)天然对称,两侧都调即可。
3. **`commentID` 不需要也无法复现原值** —— 原 ID 是 `quote-<hash>-<Date.now()>`(`host.tsx:374`),带时间戳。
   它只是前端 dedup key(`contextItemKey`),还原时新生成即可;本次改用 **part.id 作后缀**,让同一条消息
   反复撤回得到**稳定且互不相同**的 key(比时间戳更适合还原场景)。
4. **REQ-119 已替本需求拆掉一颗雷** —— 需求池原文担心"还原时再把伪路径喂给后端"。REQ-119 在
   `build-request-parts.ts` 加的 `isChatQuote` 判定使 `kind === "chat"` 的 item **永不再产 file part**,
   故还原一个 `path = <chat selection>` 的 context item 重发是安全的。

## 四、施工中发现的既有缺陷(本次顺带修 1 条 / 记录 1 条)

- **顺带修**:`PromptHistoryComment`(`prompt-input/history.ts:8`)**没有 `kind` 字段**,
  `applyHistoryComments`(`prompt-input.tsx:478`)回填时也不带 → 从 ↑ 历史找回的聊天引用**退化成文件卡片**
  (UI 显伪路径文件名而非"聊天引用",LLM 模板走 file 分支)。3 行补齐,与档二"保真"同一诉求。
- **只记录不修(留 backlog)**:纯聊天引用**根本进不了 prompt 历史** —— `historyComments()`
  (`prompt-input.tsx:447`)对无 selection 的 item 直接 `return []`,而聊天引用卡片没有 selection。
  ⇒ 需求池原文第五章"前提 2:↑ 键回溯能带回来"**对聊天引用不成立**,那条"丢弃时 toast 写『按 ↑ 可找回』"
  是错误承诺。放宽它要牵动 history 类型/序列化/回填三处,超出本次范围,回填需求池。
  **本次不做这条,也正因此,档二的保真回填是聊天引用撤回后唯一的找回路径。**

## 五、修法(user 拍板范围)

| 档 | 内容 | 触点 |
|---|---|---|
| 档一 | 动作条显示条件从"有正文"改成"有正文 / 有可用动作 / 有内联卡片";复制按钮仍由内层 `Show when={text()}` 单独守着 | `message-part.tsx` 1 行 + fork-only 新 helper |
| 档二 | 撤回保真回填引用卡片(revert 注入 / restore 对称清理 / 失败回滚还原) | fork-only 新模块 + `session.tsx` |
| toast | 撤回成功后一句「已撤回,内容已回到输入框」 | `session.tsx` + i18n |

**本次明确不做**(需求池第五章其余项,留 backlog):回滚坞标题改写、「丢弃」按钮、坞预览文字修 `[附件]` 占位、
撤回措辞统一(「撤回消息」/「已回滚消息」两套词)、`session.undo` 快捷键、聊天引用进 prompt 历史。

## 六、R8 测试用例清单(动工前列,逐条勾选)

### 单元 — `shouldShowUserMessageActions`(session-ui,Logic 清单)

- [x] T1 有正文 → 显示(基线不回归)
- [x] T2 无正文 + 无 revert 动作 + 无内联卡片 → 不显示(不给空消息凭空造动作条)
- [x] T3 **无正文 + 有 revert 动作 → 显示**(bug-repro 主线:经典布局纯引用消息)
- [x] T4 无正文 + 无 revert + V2 内联卡片 → 显示(上游既有分支不回归)
- [x] T5 V2 内联卡片但 `useV2Actions=false` → 该项不单独成立(经典布局靠 revert 分支兜)
- [x] T6 两种 `useV2Actions` 取值各跑一遍(防只修一边)

### 单元 — `extractCommentsFromParts` / `quoteCommentID`(app,Logic 清单)

- [x] T7 **synthetic comment part → 还原成 FileContextItem**(`path` / `comment` / `preview` / `commentOrigin` /
      `kind: "chat"` 全字段比对)(bug-repro 主线)
- [x] T8 非 synthetic 的普通 text part 不被误收
- [x] T9 无 metadata 的 synthetic part(老消息,走 `parseCommentNote` 文本兜底)也能还原
- [x] T10 文件引用卡片(`kind: "file"` / `origin: "file"`)同样还原,且带 selection
- [x] T11 `origin: "review"` 的行评论**不还原**(归 review 面板管,回填会与面板状态打架)
- [x] T12 同一消息两条引用 → 两个互不相同的 commentID;对同一 part 反复调用 → ID 稳定(幂等)
- [x] T13 空 parts / 脏 metadata 不抛异常

### 单元 — 历史 comment 保真(app)

- [x] T14 `applyHistoryComments` 回填带 `kind`(聊天引用不退化成文件卡片)

### 集成/回归

- [x] T15 `bun run test`(app + session-ui)全绿,无既有用例回归
- [x] T16 fork 范围 typecheck 全绿

### 真机(SOP 第 7 阶段,local 档)

- [ ] T17 选文字 → 加入聊天 → 不写正文发送 → **撤回按钮出现** → 点撤回 → 引用卡片回到输入框 → 补一句 → 重发成功
- [ ] T18 撤回 → 点回滚坞「恢复」→ 输入框**没有残留重复卡片**(修正 2 的回归)
- [ ] T19 正文 + 引用一起发 → 撤回 → 正文与卡片都回来,且重发后端无 `<chat selection>` 报错(REQ-119 联动)

## 七、验收标准

1. 经典布局(默认档)下纯引用消息 hover 出现撤回按钮,复制按钮**不**出现(没正文可复制);
2. 撤回后引用卡片保真回到输入框,可直接补写正文重发;
3. 撤回→恢复往返不产生重复卡片;
4. 撤回成功有 toast 明确告知内容去向;
5. 上述 T1-T19 全过,R4 override **0 笔**(触点全在 `packages/app/` 与 `packages/session-ui/`,均不在黑名单)。
