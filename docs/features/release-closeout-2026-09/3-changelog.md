feat-id: release-closeout-2026-09
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 实际改动记录

> 分支 `feat/release-closeout-2026-09`(基于 main)。施工中,commit 陆续追加。
> 规模 Large。1-spec 已 2026-09-17 user 审签锁版。

## commit 列表

| # | commit | 组 | 内容 | 行数 |
|---|---|---|---|---|
| 1 | `4a576548f1` | — | 开发方案立项 spec | +214 |
| 2 | `a1889915a2` | — | D-D/D-E 拍板,方案定稿 | ~ |
| 3 | `70ad754c8f` | **S1** | REQ-132 构建时注入真实基线版本号(+16 测试) | +299 |
| 4 | `0499acfe48` | **S2** | REQ-100 未送达回吐提示词条(62 语言) | +248 |
| 5 | `293f2a112b` | **S2** | REQ-100 ②③⑤ 忙闲对账改后端权威全量表(+8 测试) | +202 |
| 6 | `ee1815facc` | **S2** | REQ-100 ①④ 送达超时闸 + 回吐保真(+12 测试) | +453 |
| 7 | `5ed5325f6a` | **S4a** | REQ-131 引用卡片能看到引文原文(+6 测试) | +214 |
| 8 | `f123503078` | **S4b** | REQ-125 会话标题剥壳 🔴 **R4 override**(+22 测试) | +619 / 改上游 3 |
| 9 | `f7ee11d0e1` | **S3** | REQ-130 点 × 不再收起预览区(+5 测试) | +78 |
| 10 | `654d9e37ab` | **S5** | REQ-128 工具行命中区收窄(+7 测试) | +205 |

**新增测试合计 58 条**,零上游文件改动(除 S4b 的 `prompt.ts` 3 行)。

## 整体回归结果(2026-09-17,R9 分支内验收闸)

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --filter='!./packages/console/*'` | 29/29 successful |
| `packages/app` unit + browser | 1100 + 41 pass,0 fail |
| `packages/app` **e2e** | **142 pass,0 fail** |
| `packages/core` | 1137 pass,0 fail |
| `packages/session-ui` | 121 pass,0 fail |
| `packages/opencode` `test/session` | 438 pass,7 skip,0 fail |
| `packages/media-gen` / `adapter-feishu-lark` / `branding` / `desktop(deskfox)` | 140 / 792 / 77 / 169 pass,0 fail |

## 尚未完成 — S6 真实触发测试(本机做不了,见 1-spec §5.2)

- S6.1/6.2/6.3 REQ-132 产物层 + Console 免费额度 + 防复发(需真构建)
- S6.4 REQ-100 真机 kill 后端
- S6.5 GUI 四条真机点击 + 截图
- S6.6 Win 端产物

---

## R4 override 复核报告(第 8 笔 · REQ-125)

> 完整报告见 [`R4-override-复核报告.md`](./R4-override-复核报告.md)(2026-09-17 出具,user 同日审批)。
> 此处按 pre-commit 要求留存**逐文件 wrapper 不可行性论证**与风险评估摘要。

### 命中规则

pre-commit §4.1 黑名单 `^packages/(…|opencode|…)/`。**唯一命中文件**:
`packages/opencode/src/session/prompt.ts`。

其余同笔文件均不计入 R4:
- `packages/core/src/fork/comment-note{,.test}.ts` / `packages/opencode/src/session/fork/comment-title{,.test}.ts`
  —— fork 自建新文件,在 tag `upstream-base` 的树中不存在,享 pre-commit 动态豁免(REQ-048)
- `packages/app/src/utils/comment-note.ts` —— `packages/app` 在白名单

### 逐文件 wrapper 不可行性

**`packages/opencode/src/session/prompt.ts`(+3 行代码 / +5 行注释 / 0 删除)**

改动全貌:
```
+import { unwrapCommentNotesForTitle } from "./fork/comment-title"
+const titleMsgs = unwrapCommentNotesForTitle(msgs)
-messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
+messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...titleMsgs],
```

需求要的是**在把首条 user 消息喂给 title 小模型之前**把英文样板剥掉。逐条排除替代路:

| 候选 | 不可行原因 |
|---|---|
| 客户端 wrapper(前端建会话后 `session.rename` 自己命名) | 技术可行(D-D 的 A′),但 2026-09-17 user 拍板走 A,理由是保留小模型润色质感。已比较、已决策 |
| 改 LLM 模板 | 模板是给**主模型**看的上下文,改它外溢影响主模型对"这是引用注释"的理解。本需求只想动标题 |
| 改 `title.txt` prompt 规则 | 需求 doc 已否决:样板文本仍占据首消息开头,小模型仍可能照抄,prompt 层约束不保证 |
| `sessions.setTitle` 之后纠正 | 事后改写模型已生成的标题 = 再猜一次;此时原始注释已不在手边 |
| 插件 / 事件钩子 | `ensureTitle` 内部无任何事件或扩展点;`llm.stream` 入参在函数内构造完即用,外部拿不到也改不了 |
| 包一层 `MessageV2.toModelMessagesEffect` | 那是**共用**转换器,主模型链路也走它 —— 在那里剥壳会让主模型丢掉引用上下文,治病致残 |

**结论**:`msgs` 构造完、喂 `llm.stream` 之前,是整条链路上唯一能拦截「只给标题模型看的那份消息」
的位置,该位置在上游函数体内部、无注入点。剥壳逻辑已全部外置(fork 侧 +385 行),
上游只留一个函数调用,属 **R1 三级跳第 2 级**(新文件 + 上游 ≤5 行接口注入)标准形态,
带 FORK marker + `[feat:]` tag。新增 : 改上游 ≈ 385 : 3,远高于 3:1 健康基线。

### 风险评估

| 风险 | 评估 | 护栏 |
|---|---|---|
| 影响主模型 prompt | **不会**。`titleMsgs` 只进 `llm.stream`;`unwrapCommentNotesForTitle` 返回新数组,`msgs` 未被修改 | 单测「不改原数组」+ 上游 `test/session/prompt.test.ts` 58 pass |
| 误伤普通消息 | 不匹配模板即返回 `undefined`,调用方回落原文 | 单测:普通消息 / 空串 / 似是而非文本 |
| **模板与正则失配**(最大长期风险) | 两个模板与两条对偶正则现同住 `packages/core/src/fork/comment-note.ts`,前后端 import 同一份,无副本 | **往返契约测试** `parse(format(x)) ≡ x`,file/chat × 有无选区 × 有无引文 |
| 上游 merge 冲突 | 3 行、集中一处、带 FORK marker,冲突可见且易手工重放 | R2 marker |
| 真源迁移改变送给主模型的文案 | **已排除**:逐字节搬运,仅类型名 `FileSelection`→`CommentSelection`;`git show HEAD:… \| sed \| diff` 验证等价 | 迁移前后 app test:unit 均 1095 pass |
| REQ-123 撤回回填受影响 | 函数体未变,仅换住址;app import 路径一字未改 | app 全量绿;真机复验列入 S6 |

### 配额

本批**恰 1 笔** override,其余 5 组零 override。
**配额提示**:Q3(7/1 起)带 `[override-blacklist]` 的 commit 实测 **16 笔**(含 4 笔上游 sync merge,
黑名单改动来自上游侧),健康基线「每季 ≤2」早已不成立。已就此向 user 如实报备,
user 2026-09-17 批准本笔并知悉该计数现状;「指标口径是否需要重订」另行决策,不阻塞本笔。

### 回退方法

撤掉 `prompt.ts` 的 3 行即可(`git revert` 本笔亦干净)。fork 侧文件可原样保留 ——
`packages/core/src/fork/comment-note.ts` 作为前后端单一真源本身就有价值,与 override 无关。
