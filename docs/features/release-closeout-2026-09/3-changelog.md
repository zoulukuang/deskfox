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

### ✅ S6.6 Win 端产物 — 已完成(2026-09-17)

| 项 | 结果 |
|---|---|
| **S6.6** Win 端产物 | ✅ **已完成**,详见本文末「Win 侧回验」一节(分支 `fix/win-release-closeout-2026-09`) |

#### ✅ S6.2 Console(OpenCode Zen)免费额度 — **通过**

**证据**:

1. 构建产物 `InstallationVersion = "1.18.16"`(S6.1),不含 `0.0.0-`。
2. `packages/opencode/src/session/llm/request.ts:18` 把它拼成
   `const USER_AGENT = \`opencode/${InstallationVersion}\``,在 `:194` / `:200` 挂到**每一个模型请求**的
   `User-Agent` 头上 —— 这正是服务端设闸读的那个值(REQ-132 doc §二① 亦记载了
   `installation/index.ts:41-43` 的 `userAgent()` 同源拼装)。
3. 本地库 `opencode-local.db` 里 **114 条消息**的 `providerID` 是 `opencode`(即 OpenCode Zen),
   全部正常发出并收到回答;user 自测与本批 GUI 验证期间用的 MiMo V2.5 Free / Ling 3.0 Flash Fin Free
   都属于 Zen 的免费档。**全程未再出现 `OpenCode 1.17.0 or newer is required`。**

> **⚠️ 本文件此前写过一段错误的「S6.2 未验 + 残留风险」分析,已整段作废。** 三处错在:
> ① 把 MiMo / Ling 归给 `alibaba-cn` —— 实际它们在模型选择器的 **OpenCode Zen** 分组下,
>    `Alibaba (China)` 是**另一个**分组;Zen 的 provider id 就是 `opencode`
>    (`use-providers` mock 里写得很清楚:`{ id: "opencode", name: "OpenCode Zen" }`),
>    与 `console.opencode.ai` 那个集成同一个。
> ② 只凭 `auth.json`(v1 遗留存储)里没有 `opencode` 键就断定「没连 Console」——
>    Zen 免费档根本不需要存凭据,DB 的 `credential` 表也是空的,但模型照用不误。
> ③ 断言「版本号经由哪个 header 到达 Console,代码里查不出来」—— 查得出来,就在
>    `session/llm/request.ts`;而且 REQ-132 详情 doc 的 §二① **原文已写明** UA 拼装位置,
>    当时读那份 doc 读到一半被打断,之后却没回去读完就下了结论。
>
> 教训与本批那四次「读码觉得对、跑起来不对」是同一族的反面:**这次是"没读完就断言"**。
> 留此记录,不删。

**结论**:REQ-132 的修复链**已端到端闭环** —— 构建注入 → `InstallationVersion` → LLM 请求 UA →
Zen 免费档接受。S6 六项中 5 项本机完成、1 项(S6.6 Win 端)移交。

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

---

## Win 侧回验(2026-09-17,分支 `fix/win-release-closeout-2026-09`)

> 本批在 mac 上交付,spec §5.2 的 **S6.6「两平台产物都验」** 当时标为 🟡 移交 Win 端。
> 本节是 Windows 侧的逐项回验记录:自动闸数字与 mac 侧逐项对照,产物层与 GUI 在**真 local 产物**上实跑。
> 产物:`packages/desktop/dist-deskfox/win-unpacked/DeskFox 本地版.exe`
> (`-Env local`,appId `ai.deskfox.app.local`,DB `opencode-local.db` —— 与 user 正在使用的正式版完全隔离,
> 全程只杀 local 档进程,未碰 `DeskFox.exe` / `opencode.db`)

### 一、自动闸(与 mac 侧逐项对照)

| 项 | mac | Win | 结论 |
|---|---|---|---|
| `bun turbo typecheck --filter='!./packages/console/*'` | 29/29 | **29/29** | ✅ |
| `packages/app` unit + browser | 1100 + 41 | **1129 + 41**,0 fail | ✅ |
| `packages/app` **e2e** | 142 | **142 passed,0 fail**(`--workers=2`,3.7 分钟) | ✅ 见 §四 |
| `packages/core` | 1137,0 fail | 1141 pass / 7 skip / **1 fail** | ⚠ §三-A |
| `packages/session-ui` | 121 | **121** | ✅ |
| `packages/opencode` `test/session` | 438 / 7 skip / 0 fail | 424 / 20 skip / **1 fail** | ⚠ §三-B |
| `packages/media-gen` | 140 | **140** | ✅ |
| `packages/adapter-feishu-lark` | 792 | **792** | ✅ |
| `packages/branding` | 77 | **85**(+8,见 §二) | ✅ |
| `packages/desktop` `src/main/deskfox` | 169 | **169** | ✅ |

Win 侧 skip 数多于 mac(opencode 20 vs 7),是 `process.platform` 守卫的平台专属用例差异,非漏跑。

### 二、Win 专属补洞:REQ-132 注入块**第一次被真正执行**

mac 侧 `build-version-injection.test.ts` 的「Mac / Win 对偶」五项**全是文本断言** ——
只查 PS1 里有没有 `throw`、semver 正则长得像不像。真正被 `Bun.spawn` 执行过的只有 sh 块。
也就是说:**PS1 注入块的实际行为一次都没被验证过**,而它恰是 Windows 发布物版本号的唯一来源。
「长得一样」不等于「跑起来一样」—— PowerShell 的 non-terminating error、`-notmatch` 对 `$null` 的语义、
`ConvertFrom-Json` 的失败方式,都可能让同形代码行为分叉。

本次把 sh 侧那 6 个场景原样在 PS1 块上真跑,**8 个场景行为与 mac 侧逐项一致**:

```
A-normal-1.18.16     exit=0  RESULT=[1.18.16]      放行
B-prerelease-rc      exit=0  RESULT=[1.19.0-rc.1]  放行
C-version-missing    exit=1  RESULT=[]  提到REQ-132=yes   fail-fast
D-version-empty      exit=1  ok    E-not-semver      exit=1  ok
F-badvalue-0.0.0     exit=1  ok    G-invalid-json    exit=1  ok
H-no-package-json    exit=1  ok
```

**已固化为常驻测试**(不留一次性探针):`build-version-injection.test.ts` 新增
`describe.if(process.platform === "win32")` 一组 8 条,非 Windows 自动跳过。branding 77 → **85 pass**。

> 踩坑记死:runner `.ps1` 必须写成 **UTF-8 with BOM**。PS 5.1 读无 BOM 的 UTF-8 会按系统 ANSI
> (中文机上是 GBK)解码,注入块里的中文注释被错拆后会吃掉后续引号 → 满屏 ParserError,
> 与被测逻辑毫无关系。

### 三、两条失败的逐条定性(均**非本批引入**)

**A. `core > shell > normalizes Git Bash shell paths from env`**

用例把 `C:\Program Files\Git\bin\bash.exe` **写死**,本机 Git 装在 `D:\Git` → `stat()` 不命中 →
`select()` 回落 `win()[0]`(powershell),断言必红。**产品逻辑本身正确**,已用本机真实路径实证:

```
windowsPath("/cygdrive/d/Git/bin/bash.exe") → D:/Git/bin/bash.exe
Shell.preferred()                           → D:/Git/bin/bash.exe
```

来源是**上游** commit `f2cf607376`(pty service 重构 #32182),且整条用例被 `process.platform === "win32"`
守卫 —— mac 上永远不会跑,所以 mac 侧报 0 fail。属上游测试对 Win 的环境假设,**未改上游**。

> 连带发现(同一片代码,记录不修):`Shell.gitbash()` 在本机返回 `undefined`。它按
> `which("git")` 往上跳两级找 `bin/bash.exe`,而本机 PATH 里 `D:\Git\mingw64\bin\git.exe` 排在
> `D:\Git\cmd\git.exe` 之前 → 推出 `D:\Git\mingw64\bin\bash.exe`(不存在),真实位置是 `D:\Git\bin\bash.exe`。
> 影响:这类 PATH 布局的机器上 shell 会回落 PowerShell 而非 Git Bash。上游文件,建议单独排期。

**B. `opencode > snapshot-tool-race`**

与 2026-08-18 那次 Win 回验记录的**完全是同一条**:上游测试用
`echo '…' > D:\…\race-test.txt` 造文件,反斜杠被当转义、单引号不是引号,
文件根本没建出来 → `fileExists` 必 false。本次另行证伪了「是不是 `gitbash()` 找不到 bash 导致」——
显式 `OPENCODE_GIT_BASH_PATH=D:\Git\bin\bash.exe` 后**仍红**,故与 shell 选择无关,就是命令串本身的 POSIX 假设。
属上游测试对 Win 的适配缺口,**未改上游**。

### 四、e2e:Win 上 worker 数要从 4 再降到 2

2026-08-18 那次回验留的教训是「Win 上 e2e 必须 `--workers=4`」。本次**这条需要更新**:

| 轮次 | workers | 结果 | 耗时 |
|---|---|---|---|
| 1 | 4 | 137 passed / **5 failed** | 14.8 分钟 |
| 2 | 4 | 138 passed / **4 failed** | 9.2 分钟 |
| 3 | **2** | **142 passed / 0 failed** | **3.7 分钟** |

两轮 workers=4 的**失败集互不重叠**(轮 1 是 `session-todo-dock-navigation`,轮 2 是 `in-session-find`),
且失败形态不是超时而是**内容不符** —— `in-session-find` 期望 `2/51`、实得 `295/345`,
即并发下 mock 会话状态被别的 worker 串掉。把这 5 条单独拎出来跑:**7/7 全过,24.4 秒**。

**结论:失败集每轮都在变 + 耗时数倍膨胀 = 负载/串扰指纹,不是回归。** 关键是 workers=2 反而**比 4 快 2.5 倍**
—— 说明 4 个 worker 在这台机上已经超订(本次与上次的差异:user 的正式版 DeskFox 全程开着 7 个进程)。
**下次 Win 跑 e2e 直接用 `--workers=2`,并先看一眼机器上还开着什么。**

另:`npx playwright test … | tail` 会**吞掉真实退出码**(轮 1 拿到 exit 0 却有 5 条红)。
判定必须看摘要行或显式 `echo $?`,别信管道后的退出码。

### 五、产物层(S6.1 / S6.3 的 Win 侧)

**S6.1 通过** —— 真构建产物 dump:

```
LC_ALL=C grep -a -o -E 'var InstallationVersion = "[^"]+"' win-unpacked/resources/app.asar
  → var InstallationVersion = "1.18.16"
grep -a -c -E '0\.0\.0-(local|prod|dev|beta)' …/app.asar        → 0
InstallationChannel = "local"    ← 印证 S1.3:注入版本号未动 channel,DB 分流/身份不受影响
```

构建日志里 `packages/script` 的推导结果直接可见:`{"channel":"local","version":"1.18.16","preview":true}`
—— 未注入时这里会是 `0.0.0-local-<时间戳>`。wrapper 也如实打出
`[deskfox] REQ-132: 注入 OPENCODE_VERSION=1.18.16`。
日历号侧同时确认 local 档回落规则:`channel=local version=2026.11.0 (key=windows)`。

**S6.3 通过** —— 临时把 `packages/opencode/package.json` 改成 `0.0.0-prod-20260917` 真跑构建:

```
BUILD_EXIT=1
[deskfox] X REQ-132: 基线版本号是 '0.0.0-prod-20260917',这正是本缺陷要防的坏值
asar 时间戳 构建前=21:36:26 构建后=21:36:26 未变=True   ← 确实没产出坏包
```
验完立即还原 `1.18.16`,`git status` 干净。

### 六、GUI 真机(CDP 驱动真产物)

**全量冒烟** `smoke.py`:**22/22 通过,0 警告 0 崩溃**(启动健康 / 9 个供应商连接弹窗 / 5 个面板开关 / 6 个设置页 / 文件预览)。

**S6.5 专项** `packages/branding/smoke/win_s65_gui.py`(本次新增,长期复用):**11/11 通过**

| 项 | 实测 |
|---|---|
| REQ-130 点激活 tab 的 × | 13→12,被关的确是激活那个,**预览区未收起**(content 高 434),递补到相邻 tab |
| 回归锚:关非激活 tab | 不收起、不换激活项 |
| 回归锚:REQ-111 点 tab 本体 | 仍正常收起(content 高归 0) |
| tab × hover(本批新增) | 真 `mouseMoved` 后 `bg: rgba(0,0,0,0) → rgba(0,0,0,0.04)`,`radius=4px`,`transition=background-color, color` |

**文件预览** `win_fileviewer_check.py`(本次新增):**6/6 通过,0 渲染异常**
—— pdf/docx/xlsx 走 pdf.js canvas、png 走 img、md 走正文、json 走 `<diffs-container>` shadow DOM。

**本批 file-tabs.tsx 的两处修复通过**:重启后恢复的激活 tab(`data.json`)**内容立即在位、未空白**,8 个 tab 全部恢复
—— 即 `onMount` 自加载在 Win 上生效(修复前的症状是「点别的 tab 再点回来才正常」)。

**REQ-131 通过**(Win 真机端到端):PDF 预览里真实拖选 → 右键 → 「添加到聊天窗口」→ 行内注释框 → 「加入聊天」,
toast「已加入聊天(含问题)」,输入框出现引用卡片 `sample.pdf` + 注释,
**hover tooltip 读到 `引用:DOCXMARK` + `docs/sample.pdf`** —— 正是本批新增的「引用:<引文>」格式(修复前只有路径)。
连带确认 PDF.js textLayer 选区与自定义 `context-menu-host` 在 Windows 上工作正常。

**冷启动健康检查**:**连续 2 次 CLEAN**(无 error toast / 无 JS 异常 / 无致命 console)。
首次 FAIL 的内容是 2026-08-18 已记录在案的既有问题(上次会话开过终端 → `PTY session not found` + 一串 404);
关掉终端 tab 后连续两次 CLEAN,证明**本批未引入任何新的启动期问题**。

**REQ-125 / REQ-131 数据面 ✅**(2026-09-17 补验,user 授权消耗模型额度后进行)——
取证方式不是合成用例,而是直接查 **user 在 local 包里真实用出来的会话**(比造数据更有说服力)。
读只读副本 `opencode-local.db`:

```
本地库会话总数 20
标题为英文样板 'User Made Following Comment...' 的会话数 → 0      ← REQ-125 关键断言
经「加入聊天」发起(part.data 带 opencodeComment)的会话 2 个:
   ✓非样板 [中文标题] 期权卖方止盈规则与触发条件12
   ✓非样板 [中文标题] DeskFox 隐私与数据保护机制2
带 opencodeComment 的 part 3 条,其中落了 preview(引文原文)的 3 条 → 3/3   ← REQ-131 数据面
最近一条卡片元数据:{kind:"chat", preview:"商品期权(如豆粕、原油):无时间价值衰减的…", comment:"为什么没有时间价值衰减的周末调控?…"}
```
即:剥壳后标题是**中文且切题**、`kind` 保真、引文原文确实落盘。

**REQ-128 ✅**(Win 真机 CDP 实点,量化;脚本 `smoke/win_req128_hitarea.py`,**7/7 通过**)

| 行 | 行宽 / trigger 宽 | 右侧死区 | ① 点死区 | ② 点文字区 | ③ 再点收回 |
|---|---|---|---|---|---|
| 「已探索」(context-tool-group) | 410 / **128**(31%) | 281px | `false→false` 不展开 | `false→true` | `true→false` |
| 「Exa 网页搜索」 | 410 / 338(83%) | 71px | `false→false` 不展开 | `false→true` | `true→false` |

两族组件都验到,且「收窄不能收过头」这一面(文字区仍可点、可收回)一并钉住。
侧栏宽 410px,与 mac 侧 960px 行的比例不同但结论一致。

**REQ-100 ✅ 三条全过**(Win 真机;脚本 `smoke/win_req100_rebound.py`)

Windows 没有 `SIGSTOP`,等价手段是 ntdll 的 **`NtSuspendProcess`** 冻住
`--utility-sub-type=node.mojom.NodeService` 那个后端进程(只冻 local 档,正式版全程未碰)。

| 验收项 | 实测 |
|---|---|
| ① 消息回到输入框 + 明确 toast | ✅ **+3.0s**,toast「AI 后台服务已断开,正在自动重启… 期间的对话与文件请求会短暂失败,恢复后自动继续,无需重开应用。」 |
| ② 时间线**不残留** | ✅ 全程 0 处 |
| ③ 后端恢复后**不自动重发** | ✅ 解冻后再观察 20s,时间线仍 0 处,消息仍静静躺在输入框里 |

> ⚠️ **与 mac 侧的平台差异,如实记录**:mac 上 `SIGSTOP` 后后端保持半死,回吐由**新加的 20s 送达闸**触发(实测 18s);
> Windows 上冻住 NodeService 会被**看门狗在约 3 秒内杀掉并重启**(toast 明确说「正在自动重启」),
> 所以这里 +3.0s 的回吐走的是「后端不可达」这条**旧**路径,而不是新闸。
> 即:**Win 侧验到的是回吐语义本身(①②③ 都成立),没验到 20s 闸的计时**。
> 20s 闸由单测 T9(假时钟)覆盖,该用例在 Win 上随 app 1129 pass 一并通过。
> 想在 Win 上真验 20s 闸,得让后端保持半死超过 20 秒而不被看门狗回收 —— 本次未做。

> ⚠️ **一次险些误报,记录在案**:第一轮 ② 读到「时间线残留 1 处」,查证后是**探针自己按了两下 Enter** ——
> 同时发 `rawKeyDown` 和 `char` 会让提交触发两次:第一次在冻结期回吐,第二次在后端重启后落地,
> 读数看上去活像「后端恢复后自动重发」(正好是 ③ 要防的那件事)。改成只发 `keyDown`+`keyUp` 后
> 三条全绿。**又一次印证:报缺陷前先证伪自己的探针。**

### 七、Win 侧修掉的 1 条 + 记录不修的 1 条

**修掉:`no-row-reverse.test.ts` 负载下超时假红**(fork 自有文件,R5「flaky 48 小时内修」)

全量 `test:unit` 里该条 5633ms 超时(默认 5s)假红,单跑仅 224ms,复跑全量 0 fail;
那一轮整套耗时从 4.5s 膨胀到 21.5s。实测其真实成本仅 **~80ms**(walk 602 个文件 31ms + stripComments 48ms),
**与文件系统快慢无关** —— 是「默认 5s 对一条同步扫全树的用例余量太薄,机器一忙就假红」。
守卫类测试假红代价特别高:它让人怀疑守的那件事,而不是怀疑时钟。**显式放宽到 60s,逻辑不动。**

**记录不修:点【非激活】文件 tab 的 × 第一次必然丢失**(既有,非本批引入)

严格交替 `XOXOXO` —— 同一个 tab 第一次点没反应、第二次才关掉。装捕获阶段监听器定位到根因:

```
第1次(失败)  pointerdown/mousedown → icon-button(×)     打中
              pointerup/mouseup     → SPAN<tabs-trigger   跑到 tab 文字上去了
              click                 → tabs-list           冒到共同祖先,× 没收到 click
第2次(成功)  五个事件全部落在 × 上
```

几何实测:**按下瞬间 tab 条自动滚动**,`scrollLeft 0→97`、× 从 `x=488` 滑到 `391` —— 元素从光标下跑掉,
于是 mouseup 落空。**不是测试假象**:只开 3 个文件 tab、tab 条在天然位置(`scrollLeft: 0`)、
目标 × 本来就可见可命中时同样必现;而 421px 宽的侧栏里**开 3 个文件就会超宽**,即普通用户的日常状态。

定性为非本批引入:本批对 tab 只改了 `session-sortable-tab{,-v2}.tsx` 的 `onClick` 早返回(REQ-130)与
`index.css` 的 × hover 样式(`border-radius` / `transition` / `:hover` 背景,**均不改几何**);
而失败路径里 click 根本没冒到 wrapper(落在 `tabs-list`),早返回压根没参与。滚动发生在 pointerdown,
属上游 tab 条的 scroll-into-view 行为。**REQ-130 自身的修复在 Win 上完全成立**(上表第一行)。
按「不属本批的问题只记录不顺手修」处置,**建议单独排期**(修点大概率在 `packages/ui/src/components/tabs.tsx`,
属黑名单,需评估 R4)。

### 八、给下次 Win 回验的教训

1. **CDP 不能「瞬移」光标**。凡 hover 才出现 / 才可点的控件,必须模拟真实移动路径(先移到 tab 本体、再移到 ×),
   否则表现为「功能坏了」且零报错。三变体对照才定位清楚:JS 合成 `.click()` 不行、带 `buttons` 的完整按下不行、
   唯独「先过 tab 本体」行。
2. **取点必须三重校验**:元素存在且有尺寸 / 中心点在视口内 / `elementFromPoint` 顶层就是它。
   横向滚动的 tab 条里实测取到过 `x = -1413`,坐标合法但点了打在遮挡物上。
3. **空白判据必须穿透 shadow DOM**。`data.json` 一度被判「预览空白」,扒开 `<diffs-container>` 的 shadowRoot
   才看到 86 个节点、内容俱全。只看 `innerText` 会把渲染完好的文件误判成缺陷。
4. **探针写错会造假缺陷**。本次一度误报「CRLF 下 `parseCommentNote` 往返失败 → REQ-125 在 Win 上静默退回英文样板」,
   实为 `selection` 形状传错(`{start,end}` 而非 `{startLine,startChar,endLine,endChar}`,日志里 `lines NaN through NaN`
   就是证据)。用正确形状复测,4 种 CRLF 组合全部 `HIT / roundtrip OK`,反斜杠路径也正确取到文件名。
   **报缺陷前先证伪自己的探针。**

---

## 九、发版前三轮 code-review(2026-09-18)

本批在「已合 main、准备 /ship」之后又跑了三轮 review,**每一轮都查出上一轮修复自己引入的回归**。
三轮合计 4 笔修复 commit,全部在发版前闭环。这一节按轮次记账,便于回看是哪一步开始走偏的。

### 第一轮 —— 七条(commit `c1719f9244`)

🔴 周期对账丢了**目录作用域**。首版基于一个错误前提「后端 SessionStatus 是一张全局表」;
实际它建在 `InstanceState` 上、按 directory 分桶(`instance-state.ts:47`)。
后果:拿 A 目录的表去清 B 目录的 busy,把别的项目里**正在生成**的会话打成 idle ——
比它要修的原 bug 更糟(原 bug 是"该清的没清",首版成了"不该清的也清")。
另 🟠 停止兜底定时器从不取消、文件预览兜底在首帧命中;🟡 `/command` 两处缺送达超时、
`isCommentItem` 判据不一致、PS1 注入块 env 泄漏、`comment-card-v2` 硬编码中文兜底。

### 第二轮 —— Windows 端实测(commit `55f26ca483`,Win 端提交)

🔴 我为修 env 泄漏加的 `trap { Remove-Item ... }` **没有 `break`**。
PowerShell 的 trap 默认「跑完处理器继续往下执行」,于是两道 fail-fast 的 `throw` 被吞,
执行流直落到注入行 —— Win 实测 8 场景,**6 种坏值全部 exit=0**,
且 `0.0.0-prod-202608190542` / `latest` **被真的注入**。REQ-132 整道防线不是失效,是**反向失效**。
这条正是我标了 ⚠️「未在 Windows 实测」却仍按 🟡 低危合进 main 的那一条。
教训记在下面第十节。配套 commit `64071d81a0` 补了跨平台防回归闸(Win 专属真执行组在 mac 上整体跳过,
而这个脚本的改动十有八九发生在 mac)。

### 第三轮 —— 十四条(本轮)

4 个 🔴,其中 **3 个是第一轮修复自己引入的**:

| 级别 | 位置 | 问题 | 归属 |
|---|---|---|---|
| 🔴 | `stale-busy.ts` | 反向对账把 **`retry` 碾成 `busy`** —— 限流倒计时横幅、配额超限升级 CTA、时间线 retry 行当场消失。`SessionStatus` 是三态,`retry` 带 `attempt`/`action` 负载;退避常达数分钟而对账 60 秒一轮,几乎必中。`seedActiveSessionStatuses` 早有同款不变量(且有专门测试),反向对账绕过了它 | 第一/二轮引入 |
| 🔴 | `server-sync.tsx` | **v1/v2 协议分流被删掉**,无条件走 v1 的 `session.status()`。v2 连接下每目录都抛错被 `catch {}` 吞 → `covered` 恒空 → **两个方向全部空转**,REQ-100 在 v2 上完全失效。当时注释写的「两种协议通用」是错的:`bootstrap.ts` 同款调用紧挨着就有 `!== "v1" return` | 第一轮引入 |
| 🔴 | `submit.ts` | 主 `/command` 路径**根本没套送达超时**,commit message 声称的"三处同待遇"只落了一处。该路径先 `clearInput()` 又置 busy 再裸 `.catch` → 后端半死时斜杠命令连同附件**直接蒸发**、状态永久 busy | 第一轮声称已修,实际未修 |
| 🔴 | `submit.ts` | 停止兜底被**提前撤销**(撤销在队列分支之前)→ 点停止后 4s 内再输入 → 命中队列但兜底已撤 → 永久 busy + **队列永不排干**。修复前兜底会在 4s 后置 idle 并排干队列,故这是引入的回归且比原 bug 更重 | 第一轮引入 |

🟠/🟡 另七条:followup 路径不撤停止兜底;历史快照判据与 `replaceComments` 移除侧分叉(翻一次历史
就永久丢掉无注释的卡);文件预览兜底在 **LRU 回收**后误报「文件不可用」;队列路径的未送达文案未分流
(用户看到内部英文串);59 份 i18n 兜底副本仍是旧的断然措辞;`OPENCODE_CHANNEL` 同样泄漏进调用方会话
(比 VERSION 更危险 —— 配置在它缺省时兜底成 `dev`,被污染则**静默改判**产物身份);
PS1 的 trap 会删掉脚本自己没设过的变量。

**修法要点**
- `collectMissingBusySessions` 的判据从「本地已 busy」改为**「本地已非 idle」** —— 钉语义不枚举状态,
  将来新增第四态自动受保护;并要求 `directoryOf` 能定位,保证**凡是补得进来的就必须清得掉**
  (否则反向方向会自造出正向永远够不着的幻影 busy,还被 LRU `preserve` 永久钉住)。
- `historyComments` 与 v2 composer 里**逐行重复的两份**产出实现收口成 `contextItemsToHistoryComments`
  纯函数(正是 REQ-123 当年「两边一起漏掉 kind」的同款结构),并让快照能表达全部 file 卡。
- PS1 的 env 清理改为**存 / 还原**而非一律删除,两个变量收进同一个 `Restore-DeskFoxBuildEnv`,
  trap 与收尾共用它。

**测试**:新增 23 条(retry 族 / 目录可达性对称 / 历史往返 / `/command` 送达超时 /
协议分流结构闸 / 兜底撤销时机结构闸 / PS1 还原语义)。对其中 5 条做了**反证**(把修复退回去确认变红)。
两处结构闸自己踩过「注释里的关键词被当成代码」的坑,已改为先剥注释再做位置断言。

**回归**:typecheck 29/29 · app 1165 · session-ui 121 · ui 99 · branding 82(+8 skip),全部 0 fail。

## 十、这三轮的方法论账

同一个形态重复了三次:**读码觉得对 → 合进去 → 下一轮 review 发现它引入了更重的问题**。
共性不是粗心,是三件具体的事:

1. **把"我以为的语义"当成既成事实**。「SessionStatus 是全局表」「trap 会终止脚本」
   「两种协议通用」—— 三条都是没验证就写进注释、再据此改代码的断言。
   注释写得越笃定,后面的人(包括我自己)越不会回去查。
2. **声称与事实脱节**。commit message 写「抽成 helper 三处同待遇」,实际只落一处;
   写「注册退出时清理」,而 trap 正常结束根本不触发。**写下的话没有被任何闸检验。**
3. **测试只钉我想到的那条路径**。第一轮 100+ 条全绿却没拦住 🔴,因为一条多目录用例都没有;
   第三轮之前 21 条 stale-busy 全绿,因为一条 `retry` 用例都没有。

对应的做法已落在本轮:断言型注释必须有闸钉住它的**前提**(如「bootstrap 同款调用确实带 v1 守卫」
这条测试,上游哪天变了会先红);覆盖面声明改成可数的结构闸;
新增用例优先补**我原本没想到的那一类**(三态而非两态、多目录而非单目录、回收态而非首帧)。

⚠️ 仍然未消除的一类:`0.0.0` 那种「注释里出现关键词被结构闸误判为代码」的脆弱性 ——
本轮两处结构闸各踩一次。现在靠剥注释规避,不是根治。

## 十一、第四轮 code-review(2026-09-19,分支 `fix/preflight-round3-reconcile-and-delivery`)

三条,**全部来自第三轮自己的修复** —— 与 §十 记的形态第四次重合:两条是"修法本身带进来的新缺陷",
一条是"声称已分流、实际只分流了一半"。

| 级别 | 位置 | 问题 | 归属 |
|---|---|---|---|
| 中 | `prompt-input/history.ts` | 快照产出侧写 `id: item.commentID ?? item.key`,给**本来没有批注的卡**塞了个伪 commentID,回填时又当真 ID 写回 → **历史往返不恒等**。而三处下游都按「有无 commentID」分流,全被击穿:① `contextItemKey` 从 `file:/a.ts:3:5` 变成 `file:/a.ts:3:5:c=file:/a.ts:3:5`,与重新添加同一选区算出的 key 不等 → `context.add()` 去重失效,输入框出现**两张同源卡**并一起发给模型(REQ-116 白烧 token 那一族)② `build-request-parts.ts` 有 commentID 的分支不写 url 集,「prompt 已 @mention 同路径则丢重复卡」对历史找回的卡失效 ③ `openComment` 的 `if (!item.commentID) return` 守卫被绕过 → 点这张卡去 focus 一条**不存在**的批注,还顺手撑开评审面板 / 切走 tab(改动前点它是 no-op) | 第三轮引入 |
| 中 | `global-sync/stale-busy.ts` | 反向对账新加的 `if (!directoryOf(id)) continue` **恰好把 REQ-100 ① 要救的那一类永久关在门外**,链条是闭合的:`submit.ts` 停止兜底 4s 后把状态写成 idle → `server-session.ts` 的 LRU `preserve` 只钉住非 idle 的会话,它当场失去保护、从 `data.info` 被挤掉 → `session.get()` 返回 undefined → `directoryOf` 恒为 undefined → 反向对账永久跳过它;而唯一会重新 `resolve` 的 `loadActiveSessionsQuery` 是 `staleTime: Infinity` + 三个 `refetchOn*: false`,不会再跑第二次,后端半死也不推事件。净效果:后端还在跑,前端永久自认 idle,`queueEnabled` 判为不忙 → 用户下一条消息**绕过队列**与仍在运行的那轮并发 —— 正是首版反向对账要消灭的形态 | 第三轮引入 |
| 低 | `pages/session.tsx` | 队列路径只分流了 description,title 仍复用通用的「这条可能没发出去,**已放回输入框**」,而这条路径明确不回输入框(正文自己写的是「仍在队列里」)。同一个 toast 标题与正文互相矛盾 → 用户照标题去输入框找原文,那里是空的,以为内容彻底丢了、重新手打一遍 | 第三轮只修了一半 |

**修法要点**

- **快照只承载真批注 ID**:`PromptHistoryComment.id` 放开成可选,没有批注就缺席 ——
  store 的 dedup key 是**派生值**,回填后由 `contextItemKey` 按原样重算,不需要被持久化。
  两个 composer 的回填侧同步要求 `item.id`(批注 store 按 id 索引,没真 id 的条目不属于它)。
  文件头新增第二条不变量:**往返恒等**。原有的「判据同源」只保证"不丢",恒等才保证"不变形"。
- **守卫不删,改成可满足**:新增 `collectUnresolvedBusySessions`(与 `collectMissingBusySessions`
  严格互补,只差 `!directoryOf` 那一支),调用方拿这份名单先 `session.resolve()` 再下判定。
  补进来后状态变非 idle → LRU `preserve` 重新钉住它 → 正向清理有目录可依,
  「凡是补得进来的就必须清得掉」这个不变量**仍然成立**。
  (直接删守卫会退回第三轮修掉的"自造幻影 busy";这是两难里的第三条路。)
- **queued 专属 title**:新增 `prompt.toast.promptNotDelivered.queued.title`,en/zh 各自落地、
  其余 60 份走 en 兜底(共 62 份字典)。

**测试**:新增 19 条。
- `history.test.ts` +4(往返恒等族:无注释选区卡 / 无选区附件卡不得被造 ID、真批注照旧带回、
  快照里不得残留 store dedup key)
- `prompt-state.test.ts` +3(**用户可见现象的端到端闸**,跨 `history.ts` × `prompt-state.ts`:
  加卡 → 快照 → 回填 → 再加同一选区,仍只有一张卡)
- `stale-busy.test.ts` +6(前置名单与反向判定严格互补 / **resolve 后重跑就补得上**的两段式闭环 /
  补进来仍清得掉 / 富状态与乐观消息护栏 / 目录已知时名单为空)
- `server-sync-reconcile-protocol.test.ts` +3(结构闸:resolve 必须在判定**之前**、必须 `await`、
  单条失败不得掀翻整轮)
- `pages/session-queued-toast.test.ts` 新建 +5(结构闸 + 字典不变量:queued title 不得复用通用键、
  两条文案必须真的不同、queued title 不得声称「已放回输入框」且要点明「仍在队列里」)

**反证**:三个 🔴 修复各自退回去确认变红 —— `history.ts` 退回 → history 3 条 + prompt-state 2 条红;
`session.tsx` 退回 → 文案闸 1 条红。`stale-busy` 的两段式闭环在纯函数层由
「resolve 之后重跑」那条用例直接钉住(同一 input 下 resolve 前为空、resolve 后有值)。

**回归**:typecheck 33/33 · app 1186 pass / 0 fail(148 文件),全绿。

**回退方法**:三笔各自独立可 `git revert`(P4)——
`42e961bed5`(历史快照身份)/ `61be8a5176`(反向对账 resolve 前置)/ 本记录所在的这一笔(queued 文案 + 62 份字典)。
revert 第一笔会让无注释的卡重新拿到伪 ID(去重失效);revert 第二笔会让停止兜底后被 LRU 挤掉的
会话重新永久自认 idle;第三笔纯文案,revert 无功能影响。

### 本地版真机验证(2026-09-19,`DeskFox 本地版.app` 2026.11.2 arm64)

产物:`packages/desktop/dist-deskfox/mac-arm64/DeskFox 本地版.app`
(`bash packages/branding/scripts/build-deskfox-electron.sh -Env local`,appId `ai.deskfox.app.local`)。
**全程与 user 的正式版共存**,只杀本地版;为免踩 GUI 自动化坑 9(local 只隔离 DB 与身份、
不隔离 `~/.opencode` 配置 → 测试实例会连上真飞书桥、抢消息路由),本轮用
`XDG_CONFIG_HOME=<临时目录>` 起,配置由 local 那份拷贝而来并**摘掉 feishu-bridge plugin**;
启动日志确认无 `[wss] connected`。

| 检查 | 结果 |
|---|---|
| 全量冒烟 `smoke.py`(供应商 / 面板 / 设置 / 文件预览 / 启动) | 24 / 24 通过,0 崩溃 0 警告 |
| 冷启动健康检查 ×2(真 kill + 真冷启) | 两次都 **CLEAN**(无 error toast / JS 异常 / 致命 console) |
| 定向:引用卡历史往返保真(加卡 → 发送 → ↑ 翻历史) | 通过 —— 1 张进、1 张原样回来,卡面文字一致 |
| 定向:点历史找回的卡 | 通过 —— 不崩、无空白 tab、tabs 数不变 |
| 产物层:`renderer/assets/main-*.js` 不再含 `commentID ?? *.key` | 0 命中 ✓ |
| 产物层:`promptNotDelivered.queued.title` 已进 bundle + zh 分包含新中文标题 | ✓ |
| 双轮验收(stale 实例 + 冷启动后干净实例各跑一遍冒烟 + 定向) | 两轮均全绿 |

探针脚本:`packages/branding/smoke/round4_review_check.py`(文件头写明验什么 / 不验什么)。

**GUI 到不了、只由自动化闸覆盖的三处**(写清楚,免得下次把绿灯读成"三条都真机过了"):

1. **无 commentID 卡的去重(现象 A)** —— 唯一产生它的真实入口是命令「将所选内容添加到上下文」,
   而它 gated on `file.selectedLines`:需要代码/diff 视图的**行选区 UI**,markdown 预览区的纯文本
   选中不设这个状态(实测该命令在命令面板里不出现);另一入口「附加文件」走 native 文件选择框,
   CDP 不能驱动。→ 由 `context/prompt-state.test.ts` 的端到端闸覆盖(加卡 → 快照 → 回填 → 再加同一选区)。
   真机验到的是**同一条往返代码路径的带 commentID 分支**,即本次改动最大的回归面。
2. **反向对账(②)** —— 要"后端半死 + 停止兜底写 idle + 会话被 LRU 挤出"三件同时成立,GUI 造不出来。
   → `global-sync/stale-busy.test.ts` 两段式闭环 + `server-sync-reconcile-protocol.test.ts` 顺序结构闸。
3. **队列 toast 文案(③)** —— 要后端半死并等满 120s 超时。
   → `pages/session-queued-toast.test.ts` 结构闸 + 字典不变量,产物侧另有 bundle 扫描(见上表)。

顺带发现一处**文档过期**(未改):根 `CLAUDE.md` 验证约定段仍写「Mac wrapper(`.sh`)暂未集成 local」,
实际 `build-deskfox-electron.sh` 早已支持 `-Env local`(本轮就是用它打的)。

### 方法论账(接 §十)

§十 立的三条做法这轮**都生效了**:两处断言型注释因为带了前提闸而没再骗人,
新增用例仍然优先补"我原本没想到的那一类"。但形态本身第四次重复,说明还缺一条:

4. **修 A 时要问「这道守卫会不会恰好在 A 的链路上恒为假」**。
   第三轮给反向对账加 `directoryOf` 守卫时,推理是"不认识的会话补了没收益";
   漏掉的是"**它为什么不认识** —— 恰恰因为 A 那条路径刚把它挤出缓存"。
   守卫与它要保护的场景共享同一个因果链时,守卫会静默地把场景一起挡掉。
   同款:第三轮为了让快照"能表达全部 file 卡"而给 id 找了个 fallback,
   没问"塞进去的这个值,下游会不会当成别的语义用"。
