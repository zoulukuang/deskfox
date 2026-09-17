feat-id: release-closeout-2026-09
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 对外发版收口批 — 开发方案(1-spec)

> 上游需求计划:`OPENCODE-PLAN/需求计划/2026-09-17.md`(REQ-132 主 · REQ-100 · REQ-130 · REQ-131 · REQ-123 · REQ-125 · REQ-128)
> 本文是**仓内施工方案**:只写「代码改哪儿、怎么改、怎么验、卡在哪」。需求的根因论证与取舍不重复,见各自需求 doc。
> 规模判定:**Large**(跨 6 个 package、预计 >500 行)→ 按 CLAUDE.md 需 **user 审签后锁版**。
> 创建 2026-09-17 · 分支 `feat/release-closeout-2026-09`(基于 `main` @ `334ce3382d` 之后的最新 main)

---

## §0 交付物

一个对外可分发、**Console 免费额度可用**的 macOS + Windows 正式版,外加 6 条缺陷修复。
不含:体验增强、能力建设、专题需求(OUT OF SCOPE 照搬需求计划 §4,本文不重列)。

---

## §1 施工前基线复核 — 现场查证结论(2026-09-17)

需求计划 §1 已推翻两处文档记载(B-1/B-2),本次落到仓内逐行复核,**又推翻/修正三处**。下表是施工的事实基准,与需求计划不一致处**以本表为准**。

| # | 需求计划怎么写 | 仓内实际 | 影响 |
|---|---|---|---|
| **C-1** ✅ | B-1:Mac 侧是 `build-deskfox-electron.sh:207` | **确认**。`export OPENCODE_CHANNEL="$ENV"` 就在 `:207`;Win `build-deskfox-electron.ps1:162` `$env:OPENCODE_CHANNEL = $Env` 亦确认 | 按此改;回填订正 REQ-132 doc(S1.5) |
| **C-2** 🔴 | S2.2 要「新建」回吐输入框 + toast + 撤下乐观消息 + busy 回滚 | **这四件事代码里已经全有**,在 `packages/app/src/components/prompt-input/submit.ts:654-666` 的 `.catch()` 里:`session_status → idle` + `promptSendFailed` toast + `removeOptimisticMessage()` + `restoreInput()` + `restoreCommentItems()`;`send-followup` 内层 `submit.ts:202-209` 还有一层 `setIdle() + remove()`。**S2.2 不是"没做",是"没被触发"** | **S2.2 的工作性质变了**:从「造回吐路径」变成「让失败可被判定,好走进这条已有路径」+「补回吐保真度缺口」。详见 §3 S2 |
| **C-3** 🟡 | S2.2 ②「复用 `prompt-comments.ts` 保真回填」 | 回填走的是 `submit.ts:307` 的 `restoreCommentItems()`(不是 `prompt-comments.ts`,那条是**撤回**路径用的)。该函数还原 path/selection/comment/commentID/commentOrigin/preview,**独漏 `kind`** | 聊天引用(`kind:"chat"`)回吐后降级成文件引用 → 再发时走错 LLM 模板。S2.2 必须补 `kind`(一行) |
| **C-4** 🔴 | §5 验收门槛:「**无 R4 override**」 | 与 S4.4 / S5.1 冲突。pre-commit `BLACKLIST_REGEX` 覆盖 `packages/(…\|core\|opencode\|script\|sdk\|shared\|ui\|web)/`:<br>· **REQ-125 修法 A** 要改 `packages/opencode/src/session/prompt.ts` → **黑名单**<br>· **REQ-128 修法 B** 要改 `packages/ui/src/components/collapsible.css` → **黑名单** | **REQ-128 走零 override 替代路**(§3 S5,落 fork 侧 `basic-tool.css`);**REQ-125 经 2026-09-17 user 拍板走修法 A,批 1 笔 override**(§2 D-D)。§5.3 门槛相应改为「**恰 1 笔 override + 复核报告**」 |
| **C-5** ✅ | — | `packages/session-ui/` **不在黑名单**(它是 1.18 才有的目录,`BLACKLIST_REGEX` 未列) | S4 的 `message-part.tsx` / `comment-card-v2.tsx` / `basic-tool.css` 可自由改,无 override |
| **C-6** ⚪ | 行号 `server-sync.tsx:578` / `:305` / `:546` | 实际 `:580`(active 闸)/ `:307`(`bootingRoot` 声明)/ `:548`(读取)。全仓仅此两处,确无赋值 | 仅行号漂 ±2,结论不变 |

> **连带风险发现(计划未列)**:`packages/session-ui` **不在 `.husky/pre-push` 的测试闸里**(闸只跑 app / media-gen / adapter-feishu-lark / branding / desktop 的 deskfox 子集)。S4 的改动集中在 session-ui,**写了测试也不会被自动跑**。处置见 §5。

---

## §2 决策记录(五题全部已拍,无待决项)

| # | 题目 | 备选 | 结论 | 影响哪组 |
|---|---|---|---|---|
| **D-D** | REQ-125 会话标题改哪一侧 | (A) 服务端 `ensureTitle` 剥壳 / (A′) 客户端 rename / (B) 改模板 / (C) 改 title.txt | ✅ **(A),2026-09-17 user 拍板**。user 已知悉并接受其代价:**需 1 笔 R4 override**(`prompt.ts` 在黑名单)。<br>另一项代价「跨包正则重复」**已在施工方案里消除** —— `@opencode-ai/core` 是 `packages/app` 与 `packages/opencode` 的**共同 workspace 依赖**,把模板 + parser 提成 fork 自建文件 `packages/core/src/fork/comment-note.ts` 作单一真源,两边 import 同一份,无副本、无手工同步。该新文件享 pre-commit 的 fork 自建豁免(`upstream-base` tag 在),**不额外增加 override 笔数** | S4.4 |
| **D-E** | REQ-100 ④ 的「失败」怎么判定 | (a) AbortController + N 秒超时 / (b) 等服务端回声 / (c) 两者都做 | ✅ **(a),N=20s,2026-09-17 user 拍板**。真机证据链里那条消息服务端三处皆无(`message`/`session_input`/日志),说明请求打进半死后端后**既不 resolve 也不 reject**(挂住)。(a) 直接消灭「挂住」这一态,且 abort 保证不会「回吐后请求又迟到落地」造成双份 | S2.2 |

> D-A/D-B/D-C 已于 2026-09-17 拍板。**D-D/D-E 同日拍完,五题全定,可直接开工。**

---

## §3 施工方案(按代码片分组;组内一次回归,不拆散)

### S1 · REQ-132 构建版本号注入 —— 发版闸,排最前

**根因链(已逐行验证)**:`packages/script/src/index.ts`
```
:27  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL   // 构建脚本设了 prod → CHANNEL="prod"
:32  const IS_PREVIEW = CHANNEL !== "latest"                  // → true
:35  if (env.OPENCODE_VERSION) return env.OPENCODE_VERSION    // 构建脚本从未设 → 跳过
:36  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-<时间戳>`        // → 0.0.0-prod-202608190542
```
该值经 `packages/opencode/script/build-node.ts:24` 的 `define.OPENCODE_VERSION` 烧进 bundle → `packages/core/src/installation/version.ts:6` 的 `InstallationVersion` → 各 provider 的 `User-Agent: opencode/<版本>` → 被 Console 按 semver 判旧。

| 项 | 内容 | 落点 |
|---|---|---|
| S1.1 | 两个构建脚本在 `export OPENCODE_CHANNEL` **同一处**补注入 `OPENCODE_VERSION`,值从 `packages/opencode/package.json` 的 `version` 动态读(当前 `1.18.16`) | `build-deskfox-electron.sh:207` 附近 / `build-deskfox-electron.ps1:162` 附近 |
| S1.2 | **fail-fast**(D-B):读不到 / 读出空 / 不是 `x.y.z` → 立即报错退出。Mac 侧 `set -e` + 显式 `exit 1`;Win 侧 `throw`。读取手段:Mac 用 `node -p` 不可靠(CI 未必有 node)→ 统一用已在 PATH 的 **`bun -e`**(构建本来就依赖 bun),失败再回落 `python3 -c`;Win 用 `Get-Content \| ConvertFrom-Json` | 同上 |
| S1.3 | **绝不动 `OPENCODE_CHANNEL`**。`:27` 的 channel 优先级高于版本号推导,设了 `OPENCODE_VERSION` 后 CHANNEL 仍是 `prod`/`dev`/`local` → DB 分流、徽标、appId 全不变 | 回归验证,无代码 |
| S1.4 | 逐处回归版本号消费点(R1 风险):<br>· `daemon` 版本严格相等判定(首启重启一次属预期)<br>· `session.version` 字段<br>· `InstallationChannel`(不受影响,来自 `OPENCODE_CHANNEL` define)<br>· TUI `upgrade.ts` 自动升级路径 —— 先确认 DeskFox 分发物里有无可被用户直接拉起的 CLI/TUI 入口;有则置 `OPENCODE_DISABLE_AUTOUPDATE` | 全仓 grep `InstallationVersion` 逐点过 |
| S1.5 | **不要污染 updater 清单**:`packages/desktop/scripts/finalize-latest-{yml,json}.ts:12/22` 也读 `process.env.OPENCODE_VERSION`(那里要的是 DeskFox 日历号 `2026.11.1`,不是 `1.18.16`)。已核:`build-deskfox-electron.{sh,ps1}` **不调**这两个脚本(updater 清单走 `deploy-updater-manifest.sh` / `bridge-electron-updater.sh`,版本号从 `--version` 显式传参)。施工时**必须保持这个隔离**:`OPENCODE_VERSION` 只在构建脚本内部 export,不写进 `.env`、不进 `/ship` 的全局 shell | 新增断言 |
| S1.6 | 回填订正 REQ-132 详情 doc §二/§四 的脚本路径(B-1) | OPENCODE-PLAN 仓 |

**关键不变量**:`installer-versions.json`(DeskFox 日历号,当前 `macos: 2026.11.1` / `windows: 2026.11.0`)与 `OPENCODE_VERSION`(上游基线 `1.18.16`)是**两条互不相干的号线**,前者进安装包/updater,后者进 UA/兼容判定。S1 只动后者。

---

### S2 · REQ-100 停止键空转 + 消息静默蒸发(唯一会丢数据)

> ⚠️ 见 C-2:回吐路径**已存在**。本组的真实工作是「让失败被判出来」+「补三个缺口」。

| 项 | 内容 | 落点 |
|---|---|---|
| S2.1 | ③ 重连对账不再只覆盖 active 目录:`if (!children.active(directory)) continue` 这道闸删除 / 改为「后端权威全量忙闲表」。**倾向**:保留按目录遍历但去掉 active 闸(改动最小、可单测);若 `session.status()` 支持不带目录的全量查询则优先改成一次全量 | `packages/app/src/context/server-sync.tsx:580` |
| S2.2 | ④ **让失败可判**(D-E(a)):给 `sendFollowupDraft` 内的 `input.api.prompt(...)` 套 `AbortController` + 20s 超时。超时 → abort 请求 → reject → **走已有的** `submit.ts:654` catch(toast + 撤乐观消息 + 回吐 + busy 归 idle)。三动作原子性由现成的 `batch()` / 单一 catch 块保证,不需新造 | `packages/app/src/components/prompt-input/submit.ts`(`sendFollowupDraft` 内) |
| S2.2b | **回吐保真缺口**(C-3):`restoreCommentItems()` 补 `kind: item.kind`,`CommentItem` 类型已有该字段(`submit.ts:346`),仅 `target.context.add({...})` 漏传 | `submit.ts:307-322` |
| S2.2c | **回吐失败的静默分支**:`if (restoreInput()) restoreCommentItems(...)` —— 用户在失败前已另起输入时 `restoreInput()` 返回 false,**引用卡片就地丢失且无提示**。补:false 分支下 toast 文案改为「这条没发出去,输入框已有新内容故未覆盖」并把原文写入剪贴板 / 或仍追加引用卡片。**取最小方案:toast 文案分流 + 引用卡片照常 restore**(卡片是追加语义,不覆盖正文) | 同上 |
| S2.2d | toast 文案按 D-C 语义重写:现文案是 `prompt.toast.promptSendFailed`(通用「发送失败」)。改成明确的「**这条没发出去,已放回输入框**」+ 原因。需同时改 zh/en 词条 | `packages/app/src/**/i18n` 词条 |
| S2.3 | ① 停止键本地超时兜底:`abort()` 里点击后 3–5s 无后台响应 → 前端强制 `session_status → idle`。注意与现有 `isBackendUnreachableError` toast 并存不重复弹 | `submit.ts` 的 `abort()`(约 `:275`)+ `session.tsx` 的 `halt()` |
| S2.4 | ② 周期性对账:新增定时器(建议 60s,仅在窗口可见时跑)触发 `session.status()` 对账,不再只靠 `server.connected` | `server-sync.tsx` |
| S2.5 | ⑤ 清死变量 `bootingRoot`:`:307` 声明 + `:548` 读取,全仓无赋值。**直接删**(不补赋值 —— 补赋值等于新造一条无人验证的语义) | `server-sync.tsx:307,548` |

---

### S3 · REQ-130 点 × 关当前标签导致预览区整个收起

根因确认:`session-sortable-tab.tsx:67-72` / `session-sortable-tab-v2.tsx:50-53` 的外层 `<div>` 挂 `on:pointerdown`(capture,抓 `activeAtPress` 快照)+ `onClick`(触发 `handleTabClick` → `decideTabCollapse`);× 按钮是 `packages/ui/src/components/tabs.tsx:92` 的 `[data-slot="tabs-trigger-close-button"]`,是该 div 的**后代** → 点 × 必冒泡。

| 项 | 内容 | 落点 |
|---|---|---|
| S3.1 | **修法 A**:外层 wrapper 的 `onClick` 改为接 event,`e.target.closest('[data-slot="tabs-trigger-close-button"]')` 命中即 `return`。**两个文件一起改**(v1/v2 同构,漏一个就漏一半布局) | `session-sortable-tab.tsx` / `-v2.tsx`(均 `packages/app`,无 override) |
| S3.2 | **修法 C 当兜底 + 拿单测覆盖**:`decideTabCollapse` 增一个入参 `tabStillExists: boolean`,为 false 直接 `ignore`。A 是 DOM 行为(只能 e2e 验),C 是纯函数(可单测)—— 两条一起上才同时满足 R5 双清单的 Logic 与 View 要求 | `session-tab-collapse.ts` + `session-side-panel.tsx:334` |
| S3.3 | 回归锚:① 关**非激活** tab 本来就不收起 ② **⌘W 不经 click 不受影响** ③ **REQ-111 本体**:点激活 tab 本体仍能收起、v2 双击提升永久 tab 仍成立 | 既有测试 + 新增 |

---

### S4 · comment 簇(REQ-131 + REQ-125 + REQ-123 收尾)

数据链已验证齐全:`comment-note.ts:29 createCommentMetadata` 写入 `preview`/`kind` → `:45 readCommentMetadata` 读回 `preview`/`kind` → **`rows.ts:338 fromPart` 在这里把两者扔掉**。

| 项 | 内容 | 落点 |
|---|---|---|
| S4.1 | **REQ-131** 一条直路三个断点,**必须同一笔改完**(R4 风险):<br>① `MessageComment` 类型 + `fromPart` 返回值补 `preview` / `kind`<br>② `UserMessageComment` 类型补同两字段<br>③ `UserMessageComments` 的 `title` 改成 `comment.preview ?? comment.comment`(tooltip 显引文原文) | `packages/app/src/pages/session/timeline/rows.ts:328-355`<br>`packages/session-ui/src/components/message-part.tsx:189, :1084` |
| S4.2 | **同一处类型顺手收口**(REQ-123 §八 backlog#2):卡片副标题按 `kind` 分流 —— `kind==="chat"` 显「引用对话」(不再走 `getFilenameTruncated`),`kind==="file"`/未定义仍显 `文件名:行范围` | `comment-card-v2.tsx:~50` |
| S4.3 | 伪路径露脸:`comment-card-v2.tsx:50` 硬渲染 `<chat selection>` 字面量,由 S4.2 的 kind 分流一并消除;顺手订正 `dom-provider.ts:77` 已失效的注释 | 同上 |
| S4.4 | **REQ-125** 标题 —— **D-D 已拍:修法 A(服务端剥壳)**。三步:<br>① **提单一真源**:把 `formatCommentNote` / `parseCommentNote` / `createCommentMetadata` / `readCommentMetadata` 整体迁到 fork 自建文件 `packages/core/src/fork/comment-note.ts`(纯字符串函数,零依赖,浏览器/Node 双安全);`packages/app/src/utils/comment-note.ts` 改为**纯 re-export**,调用方一处不动<br>② **注入**:`ensureTitle` 在取到 `firstUser` 后、喂模型前,把首条 user 消息的 text part 过一遍 `parseCommentNote()`,命中则只送「用户真写的 comment + 文件名」;`kind:"chat"` 走 fork 的聊天模板**另一条分支**,须**分别判断**(两个模板长得不一样,一个正则接不住)<br>③ 未命中 / 老消息 → 原样送,行为不变 | **新建** `packages/core/src/fork/comment-note.ts`(fork 自建,享豁免)<br>**改** `packages/app/src/utils/comment-note.ts`(转 re-export,无 override)<br>**改** `packages/opencode/src/session/prompt.ts` ensureTitle ≤5 行注入 —— 🔴 **本批唯一 R4 override**,须带 FORK marker |
| S4.5 | **REQ-123 验收归档**(已交付 `d6a1aafb0f`,本批不写码):真机确认「纯引用消息 hover 出撤回 + 撤回后引用保真回填」;§八 backlog#1 不做,转独立 backlog 行 | 文档 |

> **老消息兼容**:`metadata` 缺 `preview` 时全链路退回现状(tooltip = comment、副标题 = 文件名),不新开机制。
> **回归锚**:REQ-123 的撤回回填必须仍成立 —— **不许动 `extractCommentsFromParts` / `prompt-comments.ts`**。

---

### S5 · REQ-128 工具折叠行整行可点

**修法调整(C-4)**:需求 doc 的「修法 B 改 `collapsible.css:17`」会踩 `packages/ui/` 黑名单 → 需 R4 override。改为**等效的零 override 版**:

| 项 | 内容 | 落点 |
|---|---|---|
| S5.1 | 在 fork 侧、已属 session-ui 的 `basic-tool.css` 里**作用域限定覆盖**(不碰 `packages/ui/`):<br>`[data-component="collapsible"].tool-collapsible [data-slot="collapsible-trigger"] { pointer-events: none; }`<br>`… [data-slot="basic-tool-tool-info-structured"], … [data-slot="collapsible-arrow"] { pointer-events: auto; }` | `packages/session-ui/src/components/basic-tool.css` |
| S5.2 | **hover 显箭头会一起失效**(`collapsible.css:42` 的 `&:hover [data-slot="collapsible-arrow"]` 挂在 trigger 上,`pointer-events:none` 后 trigger 不再 hover)。在同一个 fork CSS 里用 `:has()` 补回:trigger 内部可点区 hover 时显箭头 | 同上 |
| S5.3 | 视觉零变化断言:行高、右侧 action 靠右、箭头位置、cursor 均不变(不选 `width:fit-content` 的次选 A 正是为此) | 截图比对 |

---

## §4 测试用例清单(R8 — 动工前定,不许事后补)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| T1 | `packages/script` 版本推导:设 `OPENCODE_VERSION=1.18.16` + `OPENCODE_CHANNEL=prod` | unit(或脚本级断言) | VERSION=`1.18.16`,CHANNEL 仍 `prod` |
| T2 | 构建脚本读版本失败 | 手工造(改名 package.json) | **构建报错退出**,不产出 `0.0.0-*` 包 |
| T3 | `decideTabCollapse({tabStillExists:false})` | unit | `ignore` |
| T4 | `decideTabCollapse` 既有 5 条 | unit(回归) | 全绿不变 |
| T5 | `MessageComment.fromPart` 带 preview/kind 的 part | unit | 返回值含 `preview`/`kind` |
| T6 | `fromPart` 老 part(无 metadata,走 `parseCommentNote`) | unit | `preview` undefined,不抛 |
| T7 | `ensureTitle` 剥壳:文件引用模板 / 聊天引用模板 / 中文 comment / 非模板普通消息(不该被剥) | unit(`packages/opencode`) | 前三种送进模型的是用户原话 + 文件名;第四种原样透传 |
| T7b | **模板↔parser 对偶契约**:`parseCommentNote(formatCommentNote(x))` 往返等价(file / chat 两种 kind × 有无 selection × 有无 preview) | unit(`packages/core`) | 全部往返还原。**这条是单一真源的保命闸** —— 谁改了模板忘了改正则,这里必红 |
| T8 | `restoreCommentItems` 还原 `kind:"chat"` | unit | 还原后 item.kind==="chat" |
| T9 | mock 不可达 sdk → `sendFollowupDraft` 20s 超时 | unit(假时钟) | reject + 乐观消息被 remove + status→idle |
| T10 | mock 已 evict 目录 → `server.connected` | unit | 该目录仍进对账队列 |
| T11 | 工具折叠行:点右侧空白 / 点文字 / 点箭头 | e2e(app) | 空白不展开,文字与箭头展开 |
| T12 | 点 × 关激活 tab | e2e(app) | 只关一个,预览区仍开,切到相邻 tab |
| T13 | 引用卡片 hover | e2e(app) | tooltip 显引文原文 |
| T14 | REQ-111 本体:点激活 tab 本体 | e2e(回归) | 仍收起 |

**运行时 / native 风险点(显式列入,对照「CDP 自测 ≠ 真桌面 QA」)**:版本号只在**打包产物**里才成立(dev server 走不同 define 路径)→ T1/T2 必须在真构建产物上验;toast 与剪贴板是 Electron 层行为 → 必须真桌面看。

---

## §5 验收闸(R9 — 全过才向 user 提 merge)

### 5.1 自动闸
- [ ] `bun turbo typecheck --filter='!./packages/console/*'` 全绿
- [ ] `cd packages/app && bun run test` 全绿(含新增 T3-T10)
- [ ] `cd packages/session-ui && bun test` 全绿 —— ⚠️ **该包不在 `.husky/pre-push` 闸内**,本批必须**手工跑**;建议同批把它补进 pre-push(一行,`chore` 单独 commit)
- [ ] `cd packages/branding && bun test` / `cd packages/desktop && bun test src/main/deskfox` 全绿

### 5.2 真实触发测试(S6,不做不算完,**不接受纯源码复核**)
- [ ] **S6.1 产物层**:重构建后 dump `app.asar`,`LC_ALL=C grep -a -o -E 'var InstallationVersion = "[^"]+"'` → 为 `1.18.16`,**不含 `0.0.0-`**
- [ ] **S6.2 端到端**:Console 账号**免费额度**真发一条消息,不再报 `1.17.0 or newer is required`
- [ ] **S6.3 防复发**:临时制造取值失败 → 构建**报错退出**
- [ ] **S6.4 REQ-100 真机**:kill 后台子进程 → ① UI ≤N 秒复位 ② 此时发一条**带聊天引用卡片**的消息 → 原文 + 引用卡片(kind 保真)原样回输入框 + toast,**时间线不残留** ③ 后端恢复后该消息**不会**自己发出去
- [ ] **S6.5 GUI 四条真机点击 + 截图存档**:点 × 只关一个且预览区不收(⌘W 行为一致)/ 引用卡片看得到引文原文 / 加入聊天新建会话标题各不相同且中文提问出中文标题 / 工具行右侧空白点不开
- [ ] **S6.6 两平台产物都验**(Mac + Win)—— 两份构建脚本历史上漂移过

### 5.3 治理闸
- [ ] **恰 1 笔 R4 override**(REQ-125 的 `prompt.ts`,D-D 拍板),且该笔满足全部四项:① commit message 标 `[override-blacklist: REQ-125 会话标题剥壳,ensureTitle 是唯一能在喂模型前拦截的点]` ② 改动日志逐文件论证 wrapper 不可行 ③ **实施 agent 在 commit 前出复核报告**(wrapper 不可行性 / 风险评估 / 改动日志论证 三项)→ user 审 → 点头才 commit ④ 其余 5 组**零 override**
- [ ] override 配额账:本季累计 ≤ 2 笔(CLAUDE.md 健康指标),本批占 1 笔 —— 提交前先查本季已用几笔
- [ ] 改上游文件逐处带 FORK marker 并说明理由
- [ ] 7 条需求各自 doc 的验收标准逐条对过;REQ-132 doc 路径订正已回填
- [ ] 回归:历史会话可打开、数据库未换库(channel 未动)、daemon 首启重启一次属预期

---

## §6 施工顺序与提交策略

| 序 | 组 | 为什么这个次序 | commit tag |
|---|---|---|---|
| 1 | **S1** REQ-132 | 发版闸,且与其余六条零代码交集;先做完可立刻单独验产物,失败不拖累其他 | `[feat: release-closeout-2026-09]` + `[bug-repro: 构建未注入版本号致对外自称 0.0.0]` |
| 2 | **S2** REQ-100 | 唯一丢数据项,改动面最大、回归最重,趁上下文最新做 | 同上 + `[bug-repro: 后端不可达时消息静默蒸发]` |
| 3a | **S4a** REQ-131 comment 簇(S4.1-S4.3) | 三项改同一片 `MessageComment` 类型,**必须一笔到底**(R4 回归风险),不许分两次。**不含 override** | `[feat: release-closeout-2026-09]` |
| 3b | **S4b** REQ-125 标题(S4.4) | **单独一笔**,与 S4a 分开 —— override 笔要可单独 revert、可单独复核(P4)。改的是 `prompt.ts` + `core/fork/`,与 S4a 的 `rows.ts`/`message-part.tsx` 零交集,拆开不违反「同片代码不分两次」 | 同上 + `[override-blacklist: …]` |
| 4 | **S3** REQ-130 | 独立小面 | 同上 |
| 5 | **S5** REQ-128 | 一处 CSS,最后做,视觉比对一次到位 | 同上 |
| 6 | **S6** 真机 + 双平台构建 | 全码就位后一次跑完 | — |

- 分支:`feat/release-closeout-2026-09`(已建,基于最新 main)。**合 main 与 push 均需 user 同意**(三铁律)。
- 每组一笔 commit,组内不拆散(P4 可逆 + R4 回归面控制)。
- Mac 侧先做,Win 侧构建脚本改动同批但需在 Win 端验(S6.6),**Win 未验不提 merge**。

---

## §7 风险

| # | 风险 | 护栏 |
|---|---|---|
| **R1** | 版本号是全局常量,daemon 复用判定 / `session.version` / TUI 自升级三处都读 | S1.4 逐处回归;确认 DeskFox 分发物无可被用户直接拉起的 CLI 入口,否则置 `OPENCODE_DISABLE_AUTOUPDATE` |
| **R2** | **`OPENCODE_VERSION` 污染 updater 清单**(新增,计划未列):`finalize-latest-{yml,json}.ts` 同名读该 env,要的却是日历号 | S1.5:已核构建脚本不调这两个;施工后加断言,env 只在构建脚本内部 export |
| **R3** | 回吐时序不原子 → 时间线留一条 + 输入框又一条,用户重复发送 | 复用现成单一 catch + `batch()`;**abort 请求**保证不迟到落地;S6.4 专门看时间线残留 |
| **R4** | S4a 三项改同一片 `MessageComment` 代码,回归面叠加 | S4a 一笔改完,preview/kind/tooltip 三处不许分两次;S4b(标题)与之零文件交集,单独成笔以隔离 override |
| **R5** | **超时阈值误伤慢后端**(新增):20s 对正常但慢的后端可能误判 | 只对**未 resolve 的 HTTP 请求**计时(不是对模型回答计时);发版前用弱网 + 大附件各验一次;阈值做成常量便于调 |
| **R6** | `packages/session-ui` 不在 pre-push 闸 → 本批主力改动的测试写了不跑 | §5.1 手工跑 + 同批补进 pre-push(独立 `chore` commit) |
| **R7** | 发版本身的风险(签名 / 公证 / 更新源 / 两平台产物) | 走 `/ship` 既有 SOP,本方案不重新发明;发版前按既定信号制查上游 schema 漂移 |
| **R8** | **模板真源迁移**(S4.4 ①)动到 `formatCommentNote`,而它的输出是**送给主模型的正文** —— 迁移时哪怕差一个空格,都会改变 LLM 收到的文案;`createCommentMetadata` 还被 REQ-123 撤回回填依赖 | 迁移必须**逐字节等价**(纯移动,不顺手改写);T7b 往返契约测试 + 迁移前后各跑一次 `bun test` 对齐;**回归锚**:REQ-123 撤回回填真机复验一次 |

---

## §8 本文与需求计划的差异清单(供回填 OPENCODE-PLAN)

1. **S2.2 工作性质更正**(C-2):回吐路径已存在,改为「让失败可判 + 补保真缺口」。
2. **新增 S2.2b/c/d**:`kind` 漏传、`restoreInput()` 返 false 的静默分支、toast 文案按 D-C 语义重写。
3. **S4.4 修法 A 落地细化**(D-D 已拍):服务端剥壳照做并批 1 笔 override;但把模板 + parser 提成 `packages/core/src/fork/comment-note.ts` 单一真源(core 是 app 与 opencode 的共同依赖),**消除了需求 doc 预期的「跨包正则重复」代价**,并加 T7b 往返契约测试锁住模板↔正则对偶。
4. **S5.1 落点改 `packages/session-ui/src/components/basic-tool.css`**:等效于修法 B,但不动黑名单 `packages/ui/`。
5. **新增 R2 / R5 / R6 三条风险**。
6. **REQ-132 doc 路径订正**(B-1)照旧回填。
