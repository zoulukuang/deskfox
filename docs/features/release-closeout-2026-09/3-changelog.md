feat-id: release-closeout-2026-09
status: done
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
| 11 | `0007f55090` | — | pre-push 闸补入 packages/session-ui(R6 护栏) | +9 |
| 12 | `187f1f1025` | **追加** | user 真机反馈三条:引用卡片看得见引文(REQ-131 漏改的第二条渲染路径) + 纯引用可提交 + 发完不残留(+26 测试) | +372 |

**新增测试合计 84 条**,零上游文件改动(除 S4b 的 `prompt.ts` 3 行)。

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

## S6 真实触发测试 — 部分完成(2026-09-17,local 渠道本地测试版)

产物:`packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app`
(`-Env local --no-bundle`,appId `ai.deskfox.app.local`,DB `opencode-local.db` —— 与正式版完全隔离,
全程未碰 user 正在使用的 `DeskFox.app` / `opencode.db`)

### ✅ S6.1 REQ-132 产物层 — 通过

```
$ LC_ALL=C grep -a -o -E 'var InstallationVersion = "[^"]+"' '…/DeskFox 本地版.app/Contents/Resources/app.asar'
var InstallationVersion = "1.18.16"
```
**不含 `0.0.0-`**。连带确认 S1.3(不动 channel):同一 asar 里
`InstallationChannel = "local"`,`Info.plist` 的 `CFBundleIdentifier = ai.deskfox.app.local`。

**并反向印证了 S1.3 那条警戒是真的**:`packages/core/src/database/database.ts:47` 的白名单是
`["latest","beta","prod"]` —— 当初若图省事把 `OPENCODE_CHANNEL` 改成 `latest` 来修版本号,
DB 会从 `opencode-local.db` 切到 `opencode.db`,用户数据当场"凭空消失"。
实测本地版打开的正是 `~/.local/share/deskfox/opencode/opencode-local.db`(`lsof` 确认)。

### ✅ S6.4 REQ-100 真机 — 三条全过

**复现手法更正**:直接 kill 后端只会让 fetch 立刻 `ECONNREFUSED` —— 那是**旧**路径,本来就能 reject。
REQ-100 的病灶是「后端半死:socket 还开着但永不响应」,请求既不 resolve 也不 reject。
故用 **`SIGSTOP` 冻住后端 NodeService 进程**精确复现(`SIGCONT` 还原)。

| 验收项 | 实测 |
|---|---|
| ① 消息回到输入框 + 明确 toast | ✅ **18s** 触发(20s 闸内),toast 文案「这条没发出去,已放回输入框 / 后台引擎没有响应。原文和引用卡片都还在,确认后可以重新发送。」 |
| ② 时间线**不残留** | ✅ 0 次(乐观挂上 → 超时后被撤下) |
| ③ 后端恢复后**不自动重发** | ✅ `SIGCONT` 解冻后时间线仍 0 次 —— 证明 D-C 否决自动重投成立,且 abort 确实掐断了请求、没有迟到落地 |

**服务端佐证**(照 REQ-100 原始证据链的查法):探针消息在 `part` 表 **0 条**、`session_input` **0 行**
—— 与 2026-08-18 故障现场一致(消息确实没落盘),**但**它回到了输入框且有明确 toast。
这正是 D-C 定的语义:**东西没丢、在你手里、发不发你说了算**。

> 探针第一版把 `document.body.innerText` 当时间线来数,回吐后输入框里正含着那条消息 → 误报"残留"。
> 改为只数 `[data-slot="session-turn-list"]` 区域后复测通过。记此一笔:**测量口径错了会假红**。

### ✅ S6.5 REQ-128 真机点击 — 通过(量化)

CDP 实点(非源码复核):

```
选中行「已运行 1 条命令」 trigger 宽 126px / 整行宽 960px → 命中区占比 13%
① 点右侧死区 x=1556(trigger 右边界 763) → aria-expanded false→false  ✅ 不展开
② 点文字区   x=696                        → aria-expanded false→true   ✅ 展开
```
两族组件都验到:`basic-tool`(「写入 xxx」189-200px)与 `context-tool-group`(「已运行 N 条命令」126-128px)。
视觉零变化经截图核对(文字左对齐、行高、箭头位置均无位移)。

### ✅ S6.3 REQ-132 防复发 — 通过(2026-09-17)

临时把 `packages/opencode/package.json` 的 version 改成坏值 `0.0.0-prod-20260917`,真跑构建:

```
构建退出码 = 1
[deskfox] X REQ-132: 基线版本号是 '0.0.0-prod-20260917',这正是本缺陷要防的坏值
产物 app.asar 时间未变(16:53)→ 确实没产出 0.0.0 的包
```
验完立即还原 `1.18.16`。这条正是 D2 那个「`0.0.0-*` 是合法 semver」的洞补上后的守卫,
单测覆盖逻辑、此处覆盖**真构建里也如此**。

### ✅ REQ-100 ① 停止键本地兜底 — user 真机通过(2026-09-17)

### ✅ REQ-100 ② 幻影 spinner 自愈 — 通过(2026-09-17,端到端)

user 反馈「不知道怎么测」——复现条件确实刁钻(要让前端以为在忙、而后端其实不忙),
由 CDP 造场景验。**分两层各验一次**:

**机制层**(静置 130s,零用户操作,数 Network 请求):
```
+22.8s  http://127.0.0.1:.../session/status
+82.8s  http://127.0.0.1:.../session/status      ← 间隔正好 60s
```
即新加的 `RECONCILE_INTERVAL_MS = 60_000` 周期对账确实在跑;
另 kill 后端后 **+12s** 捕获到重连触发的对账请求(`server.connected` → 全局对账)。

**端到端**(忠实复现 2026-08-18 现场:发消息 → 后端开跑 → busy 由**后端事件**推来 →
立刻 `kill -9` 后端 → 看门狗 respawn,新实例 SessionStatus 是空表 → 前端缓存里是残留 busy):
```
发消息后        spin=4 running=1  busy=true
kill -9 后端
+25s            spin=0 running=0  busy=false   ✅ 清干净
```
运行态的真实 DOM 标记是 `svg[data-component="spinner"]` + 提交按钮变 `data-icon="stop"`
(第一版探针猜的 `.animate-spin` / `[aria-busy]` 全不命中,靠运行态实时 diff DOM 才抓到)。

> 对比旧版本:实测卡 **≥38 分钟**、横跨一次完整后端 respawn + 前端重连仍未复位。
> 且本次起始态就带着 2 个前几轮测试留下的残留 spinner,一并被清掉。

### ✅ 其余 GUI 条目 — user 真机通过(2026-09-17)

user 自测确认通过:点 × 只关一个且预览区不收(⌘W 行为一致)· 工具折叠行不再误触 ·
会话标题各不相同且中文出中文 · 撤回回填 · 历史会话可打开 · 引用卡片新格式 · tab × hover ·
文件预览兜底。

### ⬜ 仍需人工真机确认(CDP 做不到 / 需要原生交互)

| 项 | 为什么必须人工 |
|---|---|
| **S6.2** Console 免费额度真发一条消息 | 需真实 Console 账号与额度。**注意**:user 日常在用的 MiMo / Ling 等第三方免费模型**不走这条链路**,不能替代本项 |
| **S6.6** Win 端产物 | 需 Windows 机器 |

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
