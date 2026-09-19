feat-id: e2e-context-flow-harness
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 引用/选区核心流程的 e2e 自动化工具

> 规模:**Large**(新增 >500 行,含产品侧测试契约属性)→ 按规范本文需 user 审签后动工。
> 起因:2026-09-19 第四轮 code-review 的三条修复里,**两条在 GUI 里根本驱动不了**,
> 只能靠单测 + 结构闸兜。user 要求把「引用文件 / 预览区或聊天区选中文字 → 右键 → 加入聊天」
> 这类核心操作**打通全自动化**,并先把工具做出来。

## 一、结论先说:选 Playwright,不选 CDP-python

| | Playwright(`packages/app/e2e/`) | CDP-python(`packages/branding/smoke/`) |
|---|---|---|
| 后端 | **mock-server,零真后端**(`/file`、`/file/content`、`/session/status`、SSE 全可控) | 真 sidecar,要真项目/真模型 |
| 确定性 | 固定 fixture,可断言精确身份 | 依赖 user 工作区里恰好有什么文件 |
| 成本 | headless,秒级,可进 pre-push | 要打包 + 启动 + 可能烧 API 额度 |
| 隔离 | 天然隔离 | 会连上真飞书桥(坑 9),要额外规避 |
| 能力 | 真鼠标/键盘、穿 open shadow DOM、可等状态 | 同等,但要自己写 |
| 现状 | **已有成熟基座**:mock-server 506 行 + fixtures + 8 个开文件类 spec | 已有 smoke 引擎,面向"真产物" |

→ **核心交互流程的自动化落在 Playwright**;CDP-python 保留它真正的分工:验**打包后的真产物**
(渠道身份、冷启动、native 行为)。两者不重叠。

## 二、研究结论(尖刺实测,已跑通)

尖刺(已转正为 `e2e/regression/context-card-flows.spec.ts` + `utils/context-flows.ts`)实测拿到 5 条关键事实 —— 这些正是工具要封装的部落知识:

1. **预览内容在 shadow DOM 里**。`.md` 走 light DOM,而 `.txt` / 代码类走 `<diffs-container>` 的
   shadow root;`document.querySelector('[data-component="file-viewer"]').textContent` 是空的。
   Playwright **locator 默认穿 open shadow root**(所以 `getByText` 能用),但 `page.evaluate` 里
   手写 `TreeWalker` 不穿 —— 第一版尖刺就栽在这。
2. **选区必须用真鼠标拖出来**。产品读选区的链路是
   `mousedown → collectShadowFromEvent 收集 shadow root → ShadowRoot.getSelection()`
   (`selection-history.ts` 三级策略)。程序化 `Range + addRange` 时 `knownShadows` 是空的,
   产品读不到 → 右键菜单出不来。真鼠标拖选实测:`{"where":"shadow","text":"alpha beta gamma…"}` ✓
3. **代码视图没有行选区 UI 了**。2026-08-13 user 拍板统一交互时去掉了
   `enableLineSelection` / `enableGutterUtility`(file-tabs.tsx renderDefault 的 FORK 注释)。
   于是 `file.selectedLines` 只剩「点/悬停已有批注」和审查面板会设 —— 命令
   「将所选内容添加到上下文」(`canAddSelectionContext` 要它非空)在普通预览里**进不了命令面板**
   (真机实测:搜「所选」只出「在所有项目中搜索」)。**这就是上一轮现象 A 在 GUI 里不可达的真因**,
   不是 CDP 的能力问题。
4. **右键浮层是两步,且两个按钮同名**。菜单项「加入聊天」只是打开输入浮层,要再提交一次才落卡;
   菜单项与浮层提交按钮的文案都是 "Add to Chat"(`fileViewer.menu.addToChat` / `.input.submit`),
   靠 `.first()/.last()` 区分极脆 —— 一律把作用域收到 `[data-slot="md-selection-menu"]` 内部。
   (⚠️ 本条第一版写的是「只有填注释 + Enter 才提交、点按钮无效」——**已证伪**:2×2 交叉
   {Enter, 按钮} × {空注释, 有注释} 表明**手势无关**,真正的差异是空注释时 v2 渲染侧把卡筛掉了,
   见 §三。教训同上一轮:两个变量混在一起量,就会把结论安到错的那个上。)
5. **输入区卡片没有任何测试契约属性**。只能靠 `class*="flex-wrap"` + `max-h-[180px]` 拼,
   一次 Tailwind 调整就断。工具落地必须先补 `data-*`(见 §四)。

## 三、尖刺抓到的真 bug(已在本 feat 修掉)

> ⚠️ 本节第一版结论是**错的**,留痕订正:当时写「v2 完全不渲染引用卡」——
> 那是因为我只按 legacy 的容器 class 去量。上游 v2 **有**自己的卡片条
> (`[data-component="prompt-input-v2-attachments"]`),带注释的卡是能显示的。
> 真实缺陷比那窄得多,但同族。

**无注释的引用卡在新版界面下静默失效。**

根因(实测锤死,不是读码推断):上游 `packages/session-ui/src/v2/components/prompt-input/interaction.ts`
有**两处**都以 `!!item.comment?.trim()` 为判据 ——

- `:309 comments()` → 卡片条渲染侧
- `:333 canSubmit()` → 「有没有东西可发」

而 fork 侧 2026-09-17 那批早已把「无注释的选区卡 / 无选区的附件卡也能提交」放宽到三处:
`context-gate.ts` 的 `contextItemCount`(提交闸)、`clearableContextItems`(发送后清理)、
`prompt-state.ts` 的 `isCommentItem`(快照/回滚)。**唯独上游这两处没同源**,
而 `session.tsx` 在新版界面下用的正是这个 v2 composer。

证据链(e2e 探针,2×2 交叉 + 临时 DOM 探针):
- 右键 →「加入聊天」不填注释提交:`file-tabs.tsx` 的 `prompt.context.add` **确实执行了**
  (临时把 `mdMenu().text.length` / `path()` 暴露到 DOM 实测 `textlen=43` / `path=notes.md`,
  守卫 `!p || !m.text.trim()` 全过)。
- 但界面上:卡片条不出现(`v2StripPresent:false`)、发送键保持禁用(`sendDisabled:true`)。
- 填了注释的同一条路径:`v2Chips:1`、发送键可用。手势(Enter / 点按钮)**无影响**,2×2 一致。

用户可见后果:
1. 选中文字 → 右键 → 加入聊天 → 不填注释直接提交 → **界面上零反应**(没有卡、发送键还是灰的),
   用户只会以为"这功能坏了"。
2. 但那张卡**已经在 prompt store 里**。用户接着随便输入一句话发送时,它会**一起发给模型** ——
   用户全程不知道自己多发了一段引用(这也是 REQ-116「白烧 token」那一族)。

修法:两处判据放宽成「只看有没有卡」,与 fork 侧同源(FORK marker 就位)。
反证:退回判据 → 用例「adds a visible card even without a comment」立刻变红(0 张卡)。

## 四、方案

### 4.1 产品侧(最小改动,为可测性)

补测试契约属性,与 `e2e/utils/fixtures.ts` 的「断言优先 data-*/aria」原则一致:

| 位置 | 加什么 | 理由 |
|---|---|---|
| `prompt-input/context-items.tsx` 容器 | `data-component="prompt-context-items"` | 卡片列表锚点 |
| 同上,每张卡 | `data-context-card` + `data-path` + `data-has-comment` + `data-comment-id`(有才出) | **断言身份**,不只数个数 —— 现象 A 那类"伪 ID"必须能直接断言 |
| v2 卡片条每张卡(`session-ui/.../prompt-input/index.tsx`) | 同上一套属性 | v2 才是新版界面实际用的 composer |
| ~~`file-tabs.tsx` 右键菜单项 / 浮层~~ | **不加** | 实测已够:浮层容器有 `data-slot="md-selection-menu"`,把作用域收到浮层内部即可区分同名按钮 |

合计约 8 行,全在 fork 已改过的文件里,R2 marker 照加。**不引入任何 window 调试全局**
(先前考虑过 `window.__deskfoxTestBridge` 暴露 store 快照,评估后否掉:data-* 已够,
且调试全局要按渠道 gate,是长期负担)。

### 4.2 工具侧(`packages/app/e2e/utils/context-flows.ts`)

对外一组高层动作 + 读回,新 spec 直接组合:

```ts
bootstrapSessionWithFiles(page, { files, content, newLayout })  // 拼 mock + localStorage + goto
openFileInPreview(page, "notes.md")                            // 文件树 → tab → 等内容可见
selectTextInPreview(page, { file, needle })                    // 真鼠标拖选(穿 shadow),返回选中文本
rightClickSelection(page)                                      // 右键并等菜单出现
addToChatFromViewer(page, { comment })                         // 菜单 → 浮层 → 填注释 → Enter
selectTextInChat(page, { needle })                             // 聊天区选区(同 2 的机制)
mentionFile(page, "notes.md")                                  // @ 引用文件
contextCards(page)                                             // 读回 [{path, hasComment, commentID, label}]
sendPrompt(page, text) / historyUp(page) / historyDown(page)
```

设计约束:
- **不用 `waitForTimeout`**(e2e/AGENTS.md 硬规);每个动作等它自己那一步的可观察状态。
- 每个动作**自洽**:自己等前置、自己收尾,失败信息里带"到哪一步断的"。
- 拖选坐标从 locator 的 `boundingBox()` 算,不写死屏幕坐标。

### 4.3 落地后第一批用它写的 spec

`e2e/regression/context-card-flows.spec.ts`

## 五、R8 测试用例清单(动工前定,逐条可勾)

| # | 用例 | 层级 | 预期 |
|---|---|---|---|
| 1 | 预览区(.md,light DOM)选中 → 右键 → 加入聊天(带注释) | e2e | 出现 1 张卡,`data-path` 正确、`data-has-comment=true` |
| 2 | 预览区(.txt,shadow DOM)同上 | e2e | 同 1 —— 钉住 shadow 那条路 |
| 3 | 聊天区选中 → 右键 → 加入聊天 | e2e | 出现 1 张 `kind=chat` 卡 |
| 4 | @ 引用文件 | e2e | prompt 里出现 file part,不产生重复卡 |
| 5 | **同一选区加两次** | e2e | 仍 1 张(去重) |
| 6 | **发送 → ↑ 翻历史 → 卡片原样回来** | e2e | 1 张,`data-path`/`data-comment-id` 与发送前逐字段相同 |
| 7 | **↑ 翻历史后再加同一选区**(= 第四轮现象 A) | e2e | 仍 1 张 —— GUI 层首次覆盖 |
| 8 | 无注释卡的往返(`data-has-comment=false`、无 `data-comment-id`) | e2e | 不得凭空长出 `data-comment-id` |
| 9 | 点历史找回的卡 | e2e | 不崩、不开空白 tab;无 commentID 的卡点了是 no-op |
| 10 | 删卡(✕) | e2e | 卡消失,发送键回到 disabled |
| 11 | 右键浮层 Esc 取消 | e2e | 不落卡 |
| 12 | 新版界面(`newLayoutDesigns=true`)下 1/3 两条 | e2e | **当前会红** —— 见 §三,取决于 user 是否本 feat 一起修 |

用例 8 是关键:它把第四轮那条"伪 commentID"从单测提升到 GUI 层,**产品侧
`data-comment-id` 属性就是为它加的**。但注意用例 8 需要一个"无注释卡"的真实入口 ——
见 §六 待定 1。

## 六、待 user 拍板

1. **无注释卡的入口怎么办**(影响用例 8 能不能写):现状产品里只有
   「将所选内容添加到上下文」命令能产出,而它因 §二.3 实际不可达。三个选项:
   (a) 只覆盖带注释卡,用例 8 降级为单测已覆盖、e2e 不做;
   (b) 顺手修可达性(右键浮层允许"不填注释直接加",这本是 2026-09-17 那批的意图);
   (c) 本 feat 不动,另开需求。
2. **§三 的 v2 卡片不渲染**:本 feat 一起修 / 另开需求 / 先记录不修?
3. **工具范围**:只做 §4.2 这组,还是同期把「后端半死」类场景(mock 挂起 → 送达超时 toast、
   `/session/status` 驱动忙闲对账)也纳入 —— 那能把第四轮另两条也拉进 GUI 覆盖,但要再加一层
   mock 控制面,工作量约 +50%。
4. **要不要进 pre-push 闸**:e2e 全套目前不在 `pre-push`(只有 typecheck + 单测)。
   这批 spec 跑一轮约需 N 秒,是否纳入需 user 定。

## 七、实施后状态(2026-09-19)

已落地:
- 产品侧:上游 `interaction.ts` 两处判据同源(见 §三)+ v2 卡片条与 legacy 卡片各补
  `data-context-card` / `data-path` / `data-has-comment` / `data-comment-id` / `data-kind`。
- 工具侧:`packages/app/e2e/utils/context-flows.ts`(§4.2 那组 API,含 shadow 选区读取、
  布局分流的开文件、真鼠标拖选 + 三击兜底)。
- 用例:`packages/app/e2e/regression/context-card-flows.spec.ts` —— R8 的 1 / 2 / 6+7 / 8 / 10 / 11,
  **6 条全绿(13s)**。用例 8 做了反证。

后续项(本 feat 不做):
1. **经典布局覆盖**:两套布局的文件树是两套 DOM,经典侧栏那棵在本 bootstrap 下默认不显示
   (归 `layout.fileTree` 可见性管),要另配 localStorage;且该树行上**没有任何 data-***。
   工具侧分流已写好,差 bootstrap。考虑上游正在退役经典布局,优先级低。
2. **R8-3 聊天区选区**:`selectTextInChat` 已实现但未写用例 —— 需要 mock 一条带正文的消息,
   与本批「预览区」路径正交。
3. **R8-4 @ 引用文件**:`mentionFile` 已实现未写用例(建议列表的 role/name 契约要先确认)。
4. **R8-5 同一选区加两次**:现产品每次生成新 `md-sel-<ts>` uid → **按设计就是两张卡**
   (同文件多张不同卡全部保留)。要覆盖"去重"得走 `addSelectionToContext` 那条无 commentID 路径,
   而它因 §二.3 不可达 —— 与后续项 5 绑定。
5. **命令「将所选内容添加到上下文」实际不可达**(§二.3):`canAddSelectionContext` 要
   `file.selectedLines` 非空,而代码视图的行选区 UI 已于 2026-08-13 拿掉。
   即命令面板里有一条**用户永远点不到的命令**。需单独评估:要么恢复入口,要么摘掉命令。
6. **是否进 pre-push 闸**:本批 6 条约 13s,但 e2e 全套目前不在 pre-push(只有 typecheck + 单测)。
   待 user 定。

## 八、布局收口(user 2026-09-19 拍板,推翻 §七 的分档)

**DeskFox 只用经典布局**(`settings.general.newLayoutDesigns=false`):左侧栏文件树
(`[data-component="filetree"]`,行上无 data-*)+ legacy composer
(`[data-component="prompt-agent-control"]` 是它的特征标记)+ 「所有文件 / N 更改」两个 tab。
本地版真产物实测确认:`prompt-input-v2` 标记不存在、`prompt-agent-control` 存在。

工具与用例**都去掉 newLayout 维度**,只服务这一套。§七 的「经典布局覆盖」后续项作废
(已成为唯一覆盖面);反过来,v2 不再被任何用例覆盖。

### 上一版为什么错误地收口到 v2(教训)

`e2e/utils/waits.ts` 的 `expectSessionTitle` 找 `role=heading`,而**经典布局的会话标题不是
heading** → 整组经典布局用例卡在 bootstrap,报错只说「找不到 heading」。我把这读成了
"经典布局跑不起来",于是收口到 v2 —— **把工具的缺陷当成了产品的边界**。
现在就绪信号改成 `[data-component="session-prompt-dock"]`(两套布局都有)。

### 又一条新坑:路由形式决定发送成不成

`/server/<b64 server>/session/<id>` 进页面时,发送走"新建会话"路径 → mock 报
`Failed to create session` / `Unable to retrieve session`,卡片不清空;
`/<b64 directory>/session/<id>` 则正常。两种形式仓里都有 spec 在用,差别此前没人写下来。

## 九、当前覆盖(2026-09-19,经典布局实跑)

| # | 用例 | 状态 |
|---|---|---|
| R8-1 | .md(light DOM)选中 → 右键 → 加入聊天(带注释) | ✅ |
| R8-2 | .txt(shadow DOM)同上 | ✅ |
| R8-8 | 不填注释也落卡且可见 | ✅ |
| R8-6+7 | 发送 → ↑ 翻历史 → 身份逐字段不变 | ✅ |
| R8-10 | 删卡 | ✅ |
| R8-4 | @ 引用文件(且不产生引用卡) | ✅ |
| — | 点历史找回的卡不崩 / 不开空白 tab(第四轮发现 3 的 GUI 版) | ✅ |
| R8-11 | 浮层 Esc 取消不落卡 | ✅ |

8 条,15.3s。全量 e2e 150/150。

仍未覆盖(与 §七 一致):R8-3 聊天区选区(helper 已实现,待 mock 一条带正文的消息)、
R8-5/9 需要**无 commentID 的卡**,而产品里唯一入口(命令「将所选内容添加到上下文」)
因 §二.3 不可达。

## 十、一个待 user 定的遗留

`session-ui/.../interaction.ts` 那两处判据修复(1-spec §三)**现在没有任何测试覆盖** ——
它修的是 v2 composer,而我们不用 v2。两个选择:
(a) 留着(2 行,防上游哪天退役经典布局时冒出来),但承认无覆盖;
(b) 撤掉(减少上游侵入面 / merge 冲突面)。
建议 (a),但请 user 一句话定。
