feat-id: release-closeout-2026-09
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# R4 黑名单 override 复核报告 — REQ-125 会话标题剥壳

> 按 CLAUDE.md R4(single-person 场景):实施 agent 在 commit 前出复核报告(wrapper 不可行性 /
> 风险评估 / 改动日志论证 三项)→ **user 审 → 点头才 commit**。本文件即该报告。
> 2026-09-17 · 分支 `feat/release-closeout-2026-09`

---

## 一、这一笔要改什么

| 文件 | 性质 | 行数 | 是否触黑名单 |
|---|---|---|---|
| `packages/opencode/src/session/prompt.ts` | **上游文件** | **+3 行代码 / +5 行注释,0 删除** | 🔴 **是**(`packages/opencode/`) |
| `packages/opencode/src/session/fork/comment-title.ts` | fork 自建新文件 | +45 | 否(`upstream-base` 树中不存在 → 享 pre-commit 豁免) |
| `packages/core/src/fork/comment-note.ts` | fork 自建新文件 | +150 | 否(同上) |
| `packages/core/src/fork/comment-note.test.ts` | fork 自建新文件 | +110 | 否 |
| `packages/opencode/src/session/fork/comment-title.test.ts` | fork 自建新文件 | +80 | 否 |
| `packages/app/src/utils/comment-note.ts` | fork 文件 | 转 re-export | 否(`packages/app` 白名单) |

**整笔 override 的实际暴露面 = `prompt.ts` 的 3 行代码**:

```diff
+import { unwrapCommentNotesForTitle } from "./fork/comment-title"
...
+      const titleMsgs = unwrapCommentNotesForTitle(msgs)
-          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
+          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...titleMsgs],
```

新增行数 / 改上游行数 ≈ 385 : 3,远高于 R1 要求的 3:1 健康基线,且是 **R1 三级跳的第 2 档**
(新文件 + 上游 ≤5 行接口注入),不是第 3 档的深度改造。

---

## 二、wrapper 为什么不可行(R4 第 ② 项)

需求要的是:**在把首条 user 消息喂给 title 小模型之前**,把「加入聊天」那层英文样板剥掉。
逐条排除:

| 候选 | 为什么不行 |
|---|---|
| **客户端 wrapper**(建会话后前端 `session.rename` 自己命名) | 技术上可行(D-D 的 A′),但 **2026-09-17 user 已拍板不走这条**,理由是要保留小模型的润色质感。方案已比较、已决策,不再复议 |
| **改 LLM 模板**(`formatCommentNote` 不用英文样板) | 需求 doc 已否决:模板是给**主模型**看的上下文,改它会外溢影响主模型对"这是一条引用注释"的理解。本需求只想动标题,不该动主链路 |
| **改 `title.txt` prompt 规则** | 需求 doc 已否决:治标不稳。样板文本仍然占据首消息开头,小模型仍可能照抄;且 prompt 层的约束无法保证 |
| **在 `sessions.setTitle` 之后纠正** | 事后改写模型已经生成的标题 = 再猜一次,不如在输入端给对信息。而且此时原始注释已不在手边 |
| **插件 / 事件钩子** | `ensureTitle` 内部没有任何事件或扩展点可挂;`llm.stream` 的入参在函数内构造完即用,外部拿不到也改不了 |
| **包一层 `MessageV2.toModelMessagesEffect`** | 那是**共用**转换器,主模型链路也走它 —— 在那里剥壳会让主模型也丢掉引用上下文,属于治病致残 |

**结论**:`ensureTitle` 里 `msgs` 构造完、喂给 `llm.stream` 之前,是整条链路上**唯一**能拦截
"只给标题模型看的那份消息"的位置。这个位置在上游文件内部,没有任何现成扩展点,
故 override 不可避免。剥壳逻辑本身已全部外置到 fork 文件,上游只留一个函数调用。

---

## 三、风险评估(R4 第 ③ 项)

| 风险 | 评估 | 护栏 |
|---|---|---|
| **影响主模型的 prompt** | **不会**。注入点在 `ensureTitle` 内部,`titleMsgs` 只进 `llm.stream` 的 `messages`;`msgs` 本身未被修改(`unwrapCommentNotesForTitle` 返回新数组,有单测钉住"不改原数组") | 单测 8 条 + 上游 `test/session/prompt.test.ts` 58 pass |
| **误伤普通消息** | `stripCommentNoteForTitle` 不匹配模板时返回 `undefined`,调用方回落原文 | 单测:普通消息 / 空串 / 似是而非的文本三种 |
| **模板与正则失配(最大的长期风险)** | 两个模板与两条对偶正则现在**同住一个文件**(`packages/core/src/fork/comment-note.ts`),前后端 import 同一份,无副本 | **往返契约测试**:`parse(format(x))` 必须还原 x,file/chat × 有无选区 × 有无引文,共 6 条。谁改了模板忘了改正则,这里必红 |
| **上游 merge 冲突** | 3 行、集中在一处、带 FORK marker。上游若重写 `ensureTitle`,冲突可见且易手工重放 | R2 marker 已加;`3-changelog.md` 记回退方法 |
| **真源迁移改变了送给主模型的文案** | **已排除**:迁移是逐字节搬运,只把类型名 `FileSelection`→`CommentSelection`。已用 `git show HEAD:... \| sed 's/FileSelection/CommentSelection/g' \| diff` 验证**逐字节等价** | 迁移前后 `packages/app` test:unit 均 1095 pass |
| **REQ-123 撤回回填受影响**(它依赖 `createCommentMetadata`) | 函数体未变,仅换了住址;`packages/app` 的 import 路径一个字未改(shim re-export) | app 全量测试绿;真机复验列入 S6 |

---

## 四、配额与合规

- 本批 **恰 1 笔** override(即本笔),其余 5 组零 override。
- CLAUDE.md 健康指标:override 每季 ≤ 2 笔。**提交前请 user 确认本季已用笔数**。
- commit message 将标:`[override-blacklist: REQ-125 会话标题剥壳 —— ensureTitle 是整条链路上唯一能在喂标题模型前拦截的位置,无扩展点,剥壳逻辑已全部外置]`
- 一笔 commit 触动多个黑名单文件算 1 笔;本笔实际只触 `prompt.ts` 一个。

---

## 五、测试结果(报告出具时)

```
packages/core       bun test  → 1137 pass  0 fail  (147 files,含新增 14 条)
packages/opencode   bun test src/session/fork/comment-title.test.ts → 8 pass 0 fail
packages/opencode   bun test test/session/prompt.test.ts → 58 pass 1 skip 0 fail(上游回归)
packages/app        bun run test:unit → 1095 pass 0 fail
packages/session-ui bun test → 114 pass 0 fail
typecheck           core / opencode / app / session-ui 四包全通过
```

---

## 六、请 user 裁决

- [ ] 同意本笔 override,可 commit
- [ ] 不同意,改走 D-D 的 A′(客户端命名,零 override)
- [ ] 其他

> 若不同意,回退成本很低:`prompt.ts` 的 3 行撤掉即可,fork 侧文件可原样保留
> (`packages/core/src/fork/comment-note.ts` 作为单一真源本身就有价值,与 override 无关)。
