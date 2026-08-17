feat-id: session-presentation-input-batch
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./4-s2-audit.md

# 会话呈现与输入修复批(REQ-108/109/110/111/112/113/115/116)— 1-spec

> **来源**:OPENCODE-PLAN `需求计划/2026-08-14-2.md`(施工单,2026-08-17 版)。本文档是它的 fork 侧开发文档化——**2026-08-17 已对当前 HEAD(main `d79da924de`)逐条核实全部代码锚点**,核实结果与勘误见 §7,施工不需要再调研。
> **规模分级:Large**(8 条 REQ、触动 ≥5 个上游文件)→ 按规范 v2,**动工前本 spec 需 user 审签**。
> 各 REQ 的根因考古与决策过程详见 OPENCODE-PLAN `需求池/` 对应详情文档,本 spec 只保留施工所需结论。

## 1. 背景与失效模式

2026-08-11 上游同步(v1.17.4 → v1.18.16)后,user 连报四处会话呈现回归;S2 排查又挖出一条同族失效;另并入两条非同步回归的会话区缺口。共八条,失效模式各异:

| 子项 | REQ | 一句话 | 失效模式 |
|---|---|---|---|
| S8 | REQ-116 | 新会话残留已发送的上下文卡,下一条消息会把旧文件评论再发一次 | **上游自带缺陷**(非 fork 被改坏),静默数据污染 |
| S1 | REQ-108 | 任务执行时顶部来回扫动的蓝色进度条没了 | 同步时**整块丢失**(CSS/设置/渲染点全无) |
| S3 | REQ-109 | shell 命令逐条平铺刷屏,原折叠交互没了 | 同步时**主动撤销**(报备闭环没走完) |
| S7 | REQ-113 | 时间线噪声:连续 invalid 调用、同文件反复编辑逐条铺开 | S3 的续(新治理项) |
| S4 | REQ-110 | 会话列表"运行中"图标不亮 | **代码在但判定恒 false**(读了上游已废弃的 child store 数据源) |
| S6 | REQ-112 | 权限过滤层(REQ-078)候选源失效,fail-open | 同 S4 一个模子(child store 直读),S2 排查产出 |
| S5 | REQ-111 | 点顶部文件 tab 收不起预览器(tooltip 还在教用户点);收起动画方向不对 | **被条件关掉但提示还在** + 动画驱动被回退 |
| S9 | REQ-115 | 聊天区 LaTeX 只认 `\(…\)` 和 `$$`换行 两种写法,模型日常输出的 `$…$` / `\[…\]` 全落成裸文本 | **长期缺口**(非同步回归),已实测验证修法 |

**元问题**:连报四条说明上游同步验收只覆盖"跑不跑得起来",没覆盖"用起来还是不是原来那样"。S2 的排查清单与报备闭环是本批真正的长期价值。

## 2. 目标(一句话)

丢掉的补回(S1 进度条)、撤销的以可配置形式回归(S3 折叠)、不亮的接上真值源(S4 图标、S6 权限过滤)、被关掉的在 v2 下重新打开(S5 收起+动画),排查有没有第五处(S2);顺带堵上下文卡泄漏(S8)、让公式能被看见(S9)。

## 3. IN SCOPE

| 子项 | 内容 | 优先级 | 批次 |
|---|---|---|---|
| S8 | `submission.clear()` 时对 initial scope 也清 `context.items`;失败恢复路径保持自洽;可回贡上游 | P2 | 第 0 批 |
| S1 | 恢复进度条:CSS 动效 + 设置字段 `showSessionProgressBar`(默认 true)+ 设置开关 + i18n(zh/en)+ 新 timeline 落渲染点 | P1 | 第 1 批 |
| S3 | 新增 `shellToolPartsGrouped`(产品默认 true):连续 shell 收进**独立「已运行 N 条命令」组**;e2e fixture 种 `false` 让上游断言零改动全绿 | P1 | 第 2 批 |
| S7 | 时间线噪声:连续 `invalid` 合并计数;同文件连续 `edit`/`write` 合并成一行 + 计数。**edit 不进折叠组**,只去重不降可见性 | P2 | 第 2 批 |
| S4 | 运行中图标接回真值源:**先实测坐实**child store 数据情况,再改用全局 store / 上游 `session_working(id)`;2026-06-06 防卡死语义必须保住 | P1 | 第 3 批 |
| S6 | `ensureResolvableTracked` 改读全局 permission store 并按 directory 过滤;**不得**改 `sessionContent: false`;改完跑 `check-child-store-reads.sh` 闸验收 | P2 | 第 3 批 |
| S5 | 文件预览器:① tab 点击收起在 v2 下可用且 tooltip 与行为一致;② 恢复 flex-grow 反向驱动动画(收起从右向左);不冲掉 v2 样式与 `mirror-layout-overflow` 修复 | P1 | 第 4 批 |
| S9 | LaTeX 补齐 `$…$`(带货币护栏)/ `\[…\]`(同行+跨行)/ 同行 `$$…$$`;两份重复的 `katexExtension` 收口成单一来源 | P2 | 第 5 批 |
| S2 | 同批定制丢失/撤销/失效排查收尾:清单落本 feat 目录 + **可感知项当面向 user 过一遍**(报备闭环) | P1 | 收尾 |

## 4. OUT OF SCOPE(明确不做)

- 重新设计进度条形态 / 用 `SessionProgressIndicatorV2`(tab 头像 16px 指示器)顶替通栏条 —— 只做「恢复原样」。
- 【S3】改上游 shell 族 e2e 断言;动 `shellToolPartsExpanded`(单条卡片展开是另一个问题)。
- 【S8】改上游 `retarget`/target 语义本身;把草稿 scope key 改成按会话隔离(产品决策,面太大)。现有会话流(target == initial)发送后非 comment 附件的保留语义是上游的,不动。
- 【S9】引入 `remark-math` / 换 markdown 解析器栈(marked 链上挂着 alert/footnote/mark/emoji/shiki/mermaid 一堆 fork 定制);公式编辑器;表格单元格内含 `|` 的公式(规避靠 `\vert`,写进 changelog 已知边界);`\begin{equation…}` 环境族(REQ-115 档二,首版不做不算欠账)。
- S2 查出的其他丢失/撤销定制的修复 —— 只出清单+定性;例外:查出与 S1/S3/S4 同级可感知项则并进本批。
- Windows 端验证 —— 改的全是前端,跨平台一致;Mac 验通即可,Win 随下次发版带上。

## 5. 分项需求与架构选型(锚点已核实,2026-08-17)

### S8 · 上下文卡泄漏(REQ-116)

- **现状(已核实)**:`packages/app/src/components/prompt-input/submission-state.ts:18-21` 的 `clear()` 只 `initial.reset()` + `target.reset()`(reset 是文本重置),**initial scope 的 `context.items` 不清** → 新会话态发送后残留卡留在 composer,且走 per-project 持久化草稿不自愈。
- **修法**:`clear()` 里 initial ≠ target 时对 initial 也清 context items,与 `initial.reset()` 同批做。**不改** `prompt-state.ts` 的 `reset()`(别扩通用文本重置的职责面)。
- **失败恢复不许误伤**:`submit.ts` 的 `restoreCommentItems`(定义 `:308`)/ `restoreInput`(定义 `:493`,调用点 `:535/:569/:603/:665`)恢复到 `submission.target()`,快照已存——发送失败时卡片仍要能恢复。
- **同类波及**:新会话态的裸文件附件卡(非 comment)走同一路径,一并验。
- **回贡**:与上游逐字同逻辑,修完按 REQ-071 路线开 upstream PR(记 changelog,不阻塞本批)。

### S1 · 进度条(REQ-108)

- **基准**:commit `e77443750e`(= tag `ship-prod-2026.9.1`,同步前最后 fork 状态;⚠ 计划里写的 `deskfox-baseline` tag **不存在**,见 §7)。
- **基准四块(已核实)**:
  1. CSS:基准 `packages/app/src/index.css:315` 起,`@keyframes session-progress-whip` + `[data-component=session-progress]` 系列,在 `@layer components` 内 → 原样搬进 fork 同文件。
  2. 设置字段:**字段名沿用基准 `showSessionProgressBar`**,默认 `true`。落点照 `settings.tsx` 现有 `shellToolPartsExpanded` 三处(`:33` 类型 / `:214` 默认值 / `:426-431` withFallback)抄。
  3. 设置开关:`components/settings-general.tsx:392` 与 `components/settings-v2/general.tsx:349` 附近各加一行(照 `shellToolPartsExpanded` 那行抄),i18n key `settings.general.row.showSessionProgressBar.{title,description}`,只补 zh+en。
  4. 渲染点:基准渲染块在 `message-timeline.tsx:1400-1409`,门 = `workingStatus() !== "hidden" && settings.general.showSessionProgressBar()`,bar 背景 `tint() ?? var(--icon-interactive-base)`、动画 `session-progress-whip ${bar.ms}ms infinite`;`workingStatus` 三态 memo(`hidden/showing/hiding`,含 `timeoutDone` 信号)在基准 `:336-341`,**连信号一起搬,淡出态别丢**。现 timeline 已搬到 `src/pages/session/timeline/message-timeline.tsx`,sticky 头节点落位施工时认代码定(唯一需要动脑的一步)。

### S3 · shell 折叠(REQ-109)+ S7 · 噪声治理(REQ-113)

- **现状(已核实)**:`packages/session-ui/src/components/message-part-grouping.ts` 文件头注释即 2026-08-11 撤销记录;`groupParts` 纯函数在 `:56`、`flush` 骨架在 `:60`。摘要侧 `message-part.tsx` `contextToolSummary:813`、`AnimatedCountList`(从 `./tool-count-summary` import)。i18n key `ui.messagePart.context.command.{one,other}` 在 `packages/ui/src/i18n/zh.ts:104-105` / `en.ts:111-112` **还活着(当前孤儿)**,直接复用。
- **已拍板(2026-08-15 user 定案,不再是建议)**:折叠归**独立「已运行 N 条命令」组**,不混进「已探索」——对比例子(7 个调用混 `git checkout --`/`rm -rf`/`git reset --hard`)留档在 REQ-109 详情 doc §3,施工时**别顺手合并回同组**。
- **e2e 策略**:不改任何上游断言,只在 fixture 层种 `shellToolPartsGrouped: false`。注入点两处(已核实,原"待钉死项 11"已有答案):① `e2e/utils/mock-server.ts:55-58` 的 `addInitScript`(现种 `newLayoutDesigns: false`,照抄);② `e2e/performance/timeline-stability/fixture.ts` 的 `setupTimeline` 走**独立的** `addInitScript(:128-144)`且已支持 `settings` 参数 → **两处都种**。
- **单测**:两套口径各一组 + **把「产品默认是 grouped」锁进断言**(2026-08-11 那次撤销正是把测试反向改写后无人察觉)。
- **S7 紧跟 S3**(同一个 `message-part-grouping.ts`,顺序反了会冲突):① 连续 `invalid` 聚成一行计数,展开态复用 `basic-tool.tsx` 的 `GenericTool`(现 `:323`);② 同文件连续 `edit`/`write` 按 `input.filePath` 合并,标题沿用 `getFilename(...)`(`message-part.tsx:537/:543` 现成用法),呈现 `编辑 xxx.py ×4`。⚠ **edit 不进任何折叠组**;`patch`(用 `input.files`)首版留后。

### S4 · 运行中图标(REQ-110)+ S6 · 权限过滤层(REQ-112)

同一个模子:**代码在、类型对、marker 全,但读了上游已废弃的数据源**(1.18 把会话字段权威源挪到全局 session store,`context/directory-sync.ts:11` 的 `sessionFields` + Proxy `:35/:40` 专门做重定向;直接拿 `sync.child(...)` 原始 store 就绕过了 Proxy,读到永远为空的旧位置)。

- **S4 现状(已核实)**:`packages/app/src/pages/layout/sidebar-items.tsx`(⚠ 全路径在 `pages/layout/`)——渲染分支 `~:134-152`(Spinner/权限点/错误点/未读点),`isWorking` memo `~:187-193` 读 `sessionStore.message[id]` / `sessionStore.session_status[id]`,而 `sessionStore` 来自 `serverSync().child(props.session.directory)`(`:172`)→ 判定恒 false。上游派生 `session_working(id)` 在 `context/server-session.ts:207-208`(`(session_status[id]?.type ?? "idle") !== "idle"`,只看 status 不看 messages)。
- **S4 第一步是实测不是改码**:真跑会话上打日志,看 child store 的 `session_status[id]` / `message[id]` 到底有没有值。推断错了后面全白做。
- **防卡死资产两件(别混为一谈)**:
  1. 2026-06-06 `deriveSessionWorking` 纯函数(消费端 messages-pending 兜底,修「图标永久卡死」);
  2. 2026-06-12 `context/global-sync/session-status-reconcile.ts`(+ 单测):bootstrap 时用后端 `session.status()` 权威结果 `reconcile(merge:false)` 整体替换、清残留 busy——**作用在全局 store,正好护住迁移后的数据源**。
  决策树:reconcile 在重连/重启路径**都触发** → 直接采上游 `session_working` 口径,归档 2026-06-06 纯函数及其单测;有缺口 → 保留纯函数,只把数据源 child → 全局。预期结论偏向前者。
- **S6 现状(已核实)**:`context/permission.tsx:442-452` `ensureResolvableTracked` 的 createEffect 读 `childStore.permission` 喂 `candidateSignature` → 候选恒空 → REQ-078 过滤层 fail-open。复现单测已落库:`context/permission-resolvable-source.test.ts`(4 绿)。
- **S6 修法**:改读全局 permission store 并**按 directory 过滤**。⚠ 全局形状是 `{[sessionID]: PermissionRequest[]}`,**没有 directory 维度**——过滤谓词要经 `serverSync.session.get(id).directory` 做 session→directory 映射。**不得**改 `sessionContent: false`(上游架构决定)。
- **验收闸(已建,已核实)**:`packages/app/scripts/check-child-store-reads.sh`(实时解析 `directory-sync.ts` 的 `sessionFields` 作唯一事实源,fail-closed)已在 main 落库——⚠ 落库 commit 是 `f40f88d505`(计划里引用的 `d10a91e161` 已被 rebase 重写,见 §7),**且 main 本地 ahead origin/main 3 个 commit 未 push**。本批改完跑闸确认零违规命中即可。

### S5 · 预览器收起 + 动画(REQ-111)

- **现状(已核实)**:`pages/session/session-side-panel.tsx:204` —— `isViewerOpen: () => !settings.general.newLayoutDesigns() && view().reviewPanel.opened()`,即 `filetree-toggle`(2026-06-04)被 2026-08-11 sync 加了 legacy-only 条件(原因注释在 `:200-203`:v2 双击开永久 tab 会先触发单击 preview,toggle 误判「再次点击」把面板收掉);而 tooltip `fileTree.collapsePreviewHint`(`components/file-tree.tsx:348`)照常弹 → **提示与行为脱节**。动画:现 `:365-380` classList 用 `transition-[width] duration-[240ms]` + 显式 `style={{width: panelWidth()}}`;基准 `:283-294` 是「唯一可伸长项 + `transition-[flex-grow,flex-basis] duration-[360ms]`,flex-grow 0↔1、flex-basis 0px」——正是基准注释里点名解决"啪地弹开"的那套。
- **已拍板(2026-08-15)**:
  1. 「点 tab 收起」按恢复处理(user 确认原版支持,考古结束);**实现不复刻**基准那条依赖 Kobalte `onChange` 同值点击隐式行为的链路,在 `components/session/session-sortable-tab-v2.tsx` 的 Trigger 上**显式**加「点击已 active → 收起面板」;经典侧 `session-sortable-tab.tsx` 同步加。
  2. 文件树那条入口:tab 做完后再评估,**评估成本 > 1 小时就本批不做,但必须同时摘掉 tooltip**。不接受「提示在、功能不在」出现在交付物里。
- **恢复动画时不许冲掉**:同段 classList 里的 v2 圆角/阴影(`rounded-[10px] shadow-[var(--v2-elevation-raised)]`)/ `bg-v2-*`,以及 2026-08-12 `mirror-layout-overflow` 的 `md:order-first`(经典布局溢出方向修复)。

### S9 · LaTeX 定界符(REQ-115)

- **现状(已核实)**:`packages/ui/src/context/marked-parser.tsx:23` 与 `marked.tsx:482` 存在**两份逐字重复**的 `katexExtension`(分别在 `:15` / `:616` 注册,对应 worker 的 `createMarkdownParser` 与 `marked.tsx` 的 `jsParser` 两条渲染路径);测试文件 `marked-parser.test.ts` 已存在。死代码:`marked.tsx` 的 `renderMathInText(:447)` / `renderMathExpressions(:529)` 只在 `props.nativeParser` 分支(`:694-699`)调用,而该 prop **全仓无传入点(grep 零命中,已核实)**——确认后删或标注,别照它改。
- **顺序**:先把两份 `katexExtension` 收口成单一来源(`marked-parser.tsx` 导出、`marked.tsx` 引用),后面所有规则改动才只有一个落点。
- **规则(2026-08-16 已用 `bun test` 实测)**:
  - `$…$` 行内,起点正则 `/\$(?![\s$])((?:\\.|[^$\\\n])*?)(?<!\s)\$(?!\d)/`(四条真实样例各命中 1、三条货币负例命中 0)。护栏:开定界后不接空白 / 闭定界前不接空白 / 闭定界后不接数字 / 不跨行;`\$` 转义不参与配对。
  - `\[…\]` 块级(同行+跨行)。⚠ `\[` 的反斜杠会先被 markdown 转义吃掉(实测 6/7 条输出成 `[E = mc^2]`),tokenizer 的 `start()` 要在转义前拿到位置;拿不到则退 `preprocess`/`walkTokens` 层,**但不得影响同链其它扩展**(alert/footnote/mark/emoji/shiki/mermaid)。
  - `$$` 块放宽:去掉「后必须立刻换行」强制 + 允许前置 ≤3 空格缩进。
- **失败呈现口径**:现 `throwOnError: false` 渲成红字;补齐定界符后误命中概率上升,**倾向回退成原始文本**(聊天流里红字更像应用自己出错),施工时看实际观感定,记 changelog。

### S2 · 排查收尾(REQ-108)

- 第一轮六维机械排查**已跑完(2026-08-15)**,产出与负面结论(5 个维度已排除)在 OPENCODE-PLAN 计划 §「S2 排查结果」;新发现 1 条即 REQ-112。
- 本批剩两件:① 清单落**本 feat 目录**(每条:基准位置 / 当前状态 / 失效模式四分类 / 是否可感知 / 建议+理由;空清单也要显式写「已扫,无其他项」);② **报备闭环**——可感知项当面向 user 过一遍并记拍板(2026-08-11 撤销记录标了「⚠ 待报 user」没落地,user 是自己撞上的,这条是防再犯的动作项)。
- 顺带核:`需求总览.md` 里 REQ-103(上游同步 1.18.x)状态仍 ⬜ 但主体已交付随 2026.10.0 发版,确认后按 `需求管理规范.md` §D 归档。

## 6. R8 测试用例清单(兼全批验收门槛)

> 层级:【单测】bun test 纯逻辑;【e2e】Playwright;【🔒真机】真桌面必做,不接受 mock/CDP 顶替。

**S8 · 上下文卡泄漏**
- [ ]【单测】构造 initial(workspace scope)+ target(新 session scope),`retarget` → `clear` 后 **initial 的 `context.items` 为空**(**先红后绿**,不接受"改完顺手补个绿测")
- [ ]【单测】发送失败路径:评论卡/附件卡照旧恢复到 composer,未被误清
- [ ]【🔒真机】原始复现路径:预览文件右键「添加到聊天窗口」提评论 → 新会话态发送 → 再开新会话 composer 干净;**切一次项目再确认不回退**;裸文件附件卡同样不泄漏

**S1 · 进度条**
- [ ]【🔒真机】真跑 >10s 任务:顶部出现 2px 条来回扫动,结束**淡出**而非硬消失
- [ ]【🔒真机】设置开关默认开;关→条消失,开→再现,改完即时生效不用重启
- [ ]【🔒真机】深浅主题各看一次;颜色走 `tint() ?? var(--icon-interactive-base)`,无写死十六进制蓝

**S3 · shell 折叠**
- [ ]【单测】`grouped=true` 连续 shell 折叠 / `grouped=false` 独立成行,各一组;**「产品默认 = grouped」锁进断言**
- [ ]【e2e】上游 shell 族八文件全绿且**断言零改动**(tool-projection / lifecycle-state / shell-outline / reducer-projection / file-projection / tool-state / history-root / accessibility)
- [ ]【🔒真机】真跑 10+ 条 shell 的任务:默认折叠成「已运行 N 条命令」一行,点开可见每条,单条可再展开看输出;设置切回上游口径即时生效

**S7 · 噪声治理**
- [ ]【单测】连续 / 间隔 / 混合三种序列各一组;中间夹其他工具时断开重新计数
- [ ]【单测】edit 单次仍独立成行(不进折叠组,可见性不降级);同文件连续编辑合并 `编辑 xxx.py ×4` 且文件名在标题直接可见
- [ ]【🔒真机】真跑一轮多次同文件编辑的任务

**S4 · 运行中图标**
- [ ]【单测】沿用/迁移 working 判定单测(按决策树结论:采上游口径则归档旧纯函数单测,保留则改数据源)
- [ ]【🔒真机】真跑长任务全程盯列表:亮起/结束熄灭;多会话并行只亮真在跑的行(不误亮不漏亮)
- [ ]【🔒真机】防卡死回归:中途硬杀 / 断连重连后图标**不残留**(2026-06-06 老病不能改回去)

**S6 · 权限过滤层**
- [ ]【单测】既有复现测试 `permission-resolvable-source.test.ts`(4 例)转为验收:改后全绿
- [ ]【脚本闸】`bash packages/app/scripts/check-child-store-reads.sh` 零违规命中(S4/S6 改完各跑一次)

**S5 · 预览器收起 + 动画**
- [ ]【e2e】上游 file-browser e2e 全绿(v2 双击开永久 tab 不被误伤)
- [ ]【🔒真机】v2 点当前文件 tab → 收起,再点 → 展开;收起从右向左、展开从左向右;`prefers-reduced-motion` 下不动画
- [ ]【🔒真机】tooltip 与行为一致(文件树可收起,或提示已摘);经典布局不回退(`md:order-first` 溢出修复与 v2 圆角/阴影都在)

**S9 · LaTeX**
- [ ]【单测】14 条语法矩阵全断言(该渲染的渲染、**该保持裸文本的也锁住**)+ user 毕达哥拉斯样例四条公式(含表格单元格内)+ 三条货币负例(`一台 $100,另一台 $200` / `价格是 $5.00 起` / `成本 $ 5 左右` + `\$100` 均**不得**产生 `class="katex`)+ 代码块/行内代码 `$` 隔离
- [ ]【单测】**两条渲染路径各跑同一组矩阵**(worker `createMarkdownParser` + `marked.tsx` `jsParser`)且 `katexExtension` 已收口成单一来源;原支持的 `\(…\)` 与 `$$`换行 不回退
- [ ]【🔒真机】让模型输出混排段(行内 `$` + `\[` 块 + 代码块 `$PATH` + 一个价格),肉眼确认公式出图、金额没被吃

**S2 · 排查收尾**
- [ ]【文档】清单落本 feat 目录,逐条含基准位置/当前状态/失效模式/可感知/建议;空也显式写「已扫,无其他项」
- [ ]【动作】可感知项当面向 user 过一遍并记拍板结果

## 7. 审查勘误(2026-08-17 对 HEAD `d79da924de` 逐锚点核实)

计划(OPENCODE-PLAN `需求计划/2026-08-14-2.md`)绝大多数锚点与当前代码一致,以下几处以本表为准:

| # | 计划里的引用 | 核实结果 | 施工口径 |
|---|---|---|---|
| 1 | S2 基准 `deskfox-baseline`(`e77443750e`) | **`deskfox-baseline` tag 不存在**;hash 有效,= `ship-prod-2026.9.1`(Win prod 2026.9.1,上游同步前最后 fork 状态) | 一律用 hash `e77443750e` 引用;如需 tag 用现成 `ship-prod-2026.9.1` |
| 2 | 闸落库 commit `d10a91e161` | 该 commit 已被 rebase 重写,**不在任何分支**;现役 = `f40f88d505`(+ typecheck 修复 `c86f3efa61`,经 merge `d79da924de` 进 main)。**main 本地 ahead origin/main 3 个 commit,未 push**(计划「施工前先核已推没有」→ 答案:没推) | 引用改 `f40f88d505`;push 时机随本批 merge 一并向 user 报 |
| 3 | `sidebar-items.tsx:134/:188` | 全路径 `packages/app/src/pages/layout/sidebar-items.tsx`,行位一致 | 已写进 §5 |
| 4 | `global-sync/session-status-reconcile.ts` | 实际在 `packages/app/src/context/global-sync/` 下(+ 同名 .test.ts) | 已写进 §5 |
| 5 | `basic-tool.tsx:336` GenericTool | 现 `:323`(行号漂移) | 认代码不认行号 |
| 6 | 待钉死项 11(timeline-stability fixture 注入覆盖面) | **已核出答案**:`setupTimeline` 走独立 `addInitScript(:128-144)`,不经 `mock-server.ts:55` 注入点,但**已支持 `settings` 参数** | 两处都种,不改断言 |
| 7 | 待钉死项 2(baseline 设置字段与三态 memo) | 基准渲染门就是 `settings.general.showSessionProgressBar()`(字段名现成);`workingStatus` memo 在基准 `:336-341`,依赖 `timeoutDone` 信号 | S1 字段名照抄;memo 连信号一起搬 |
| 8 | S5 基准动画 | 已核:基准 `session-side-panel.tsx:283-294`,`transition-[flex-grow,flex-basis] duration-[360ms]` + flex-grow 0↔1 / flex-basis 0px;现 fork `:365-380` 为 `transition-[width]` + 显式 width | 按基准套路恢复,保住同段 v2 样式与 `md:order-first` |

其余锚点(S8 `submission-state.ts:18-21`、`submit.ts:603/:665`、S1 settings 三处 `:33/:214/:426`、两设置面板 `:392/:349`、S3 `groupParts:56/flush:60`、`contextToolSummary:813`、i18n 孤儿键 `zh:104/en:111`、`mock-server.ts:55-58`、S4 `server-session.ts:207`、`directory-sync.ts:11/:35/:40`、S6 `permission.tsx:442`、复现单测文件、闸脚本、S5 `session-side-panel.tsx:204` 门控与 `file-tree.tsx:348` tooltip、S9 `katexExtension` 双份 `:23/:482` 与死代码 `:447/:529/:694`)**全部核实一致**。

## 8. 前置与依赖

- **user 审签本 spec**(Large 硬门槛)。开工前无其他待答项——原「开工前待表态项」已于 2026-08-15 全部拍完(S3 折叠口径 = 方案 B 独立组)。
- main 本地 ahead 3(REQ-112 复现单测 + 闸脚本)未 push;本 feat 分支已含这三个 commit,无阻塞,但 push 决策留给 user。
- 施工中待确认项(非阻塞,随手确认)collected 在 `2-plan.md` §4。
