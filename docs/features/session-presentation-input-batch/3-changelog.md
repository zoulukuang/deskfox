feat-id: session-presentation-input-batch
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./4-s2-audit.md

# 会话呈现与输入修复批 — 3-changelog

> 状态:**代码 + 自动化 + 真机验收全部完成,待 user 拍板后合 main**。
> 分支 `feat/session-presentation-input-batch`,截至 2026-08-18 共 8 笔 commit,102 文件 +2784/-152
> (其中约 800 行是 62 个 locale 的 i18n 机械回填)。

## commit 列表

| commit | 批 | 内容 |
|---|---|---|
| `632931c259` | — | 三文档 + 全锚点核实(勘误 8 处,见 1-spec §7) |
| `aad041be77` | 第 0 批 | **S8/REQ-116** 上下文卡泄漏 |
| `557d151890` | 第 1 批 | **S1/REQ-108** 恢复会话进度条 |
| `33fc92c056` | 第 2 批 | **S3/REQ-109** shell 折叠可配置回归 |
| `30401b81ea` | 第 2 批 | **S7/REQ-113** 时间线噪声治理 |
| `6fa866a355` | 第 3 批 | **S4/REQ-110 + S6/REQ-112** 接回全局 store + 补回防卡死调用点 |
| `0442721164` | 第 4 批 | **S5/REQ-111** 预览器收起 + 动画方向 |
| `c5dc1aeb41` | 第 5 批 | **S9/REQ-115** LaTeX 定界符 + katexExtension 收口 |

先行落库(本批开工前已在 main):`f40f88d505` REQ-112 复现单测 + `check-child-store-reads.sh` 闸;
`c86f3efa61` typecheck 修复;`d79da924de` merge。⚠️ 这三笔**至今未 push**。

## 逐项改动

### S8 · 新会话残留已发送上下文卡(REQ-116)

`prompt-input/submission-state.ts` `clear()`:initial ≠ target 时对 initial 也清 `context.items`。
retarget 已把卡交接给新会话 scope,清 initial 不丢内容;现有会话流(target === initial)上游语义未动。
**上游自带缺陷**(与 upstream/dev 逐字同逻辑)→ 可按 REQ-071 路线回贡。

### S1 · 会话进度条(REQ-108)

四块按基准 `e77443750e` 原样搬回:`index.css` 动效(含 220ms 淡出)/ `showSessionProgressBar` 设置字段(默认 true)/
两处设置面板开关 / `timeline/message-timeline.tsx` sticky 会话头内的渲染点。
纯逻辑按 R5 helper extract 抽到 `timeline/session-progress.ts`(扫动周期 + 三态推进)。

### S3 · shell 折叠(REQ-109)

`shellToolPartsGrouped`(**产品默认 true**);`groupParts(parts, { shellGrouped })` 缺省 = 上游逐字口径。
命令**自成一组**(「已运行 N 条命令」),不并进「已探索」—— 2026-08-15 user 拍板内容。
`ContextToolGroup` 加可选 `labels` 复用同一折叠外壳,文案由 app 侧传入 → **本笔不需要 R4**(与 2026-06-19 旧实现不同)。

### S7 · 时间线噪声治理(REQ-113)

- `invalid` 连续合并成折叠组「N 次无效调用」,可展开看每条。
- `edit`/`write` 同文件连续编辑合并成一行 + 标题上 `×N`,**不进任何折叠组**;单次编辑仍独立成行。
- ⚠️ 施工中被上游 `tool-projection` e2e 抓到自引入缺陷:连续**失败**的 edit+write 同文件被错并,
  错误卡 10→9 张(等于藏掉一次失败)。修法:合并只认 `completed`,并补 3 条单测钉死。

### S4 + S6 · 接回全局 store(REQ-110/112)

根因坐实为**写入路径已被结构性关闭**(不是"某次观察为空"):child store 初始三字段全空 →
两个 `applyDirectoryEvent` 调用点都传 `sessionContent: false` → `event-reducer:124` 把
`SESSION_CONTENT_EVENTS` 整组 early return → bootstrap 里 `input.session` 恒存在、只写全局。

- S4:`sidebar-items.tsx` isWorking 的 messages/status 换全局;**保留** `deriveSessionWorking`(不采上游
  `session_working`),因防卡死链路本就有缺口(见下),不在同一处叠加第二个变更面。
- S6:`ensureResolvableTracked` 换全局 permission + 新纯函数 `scopePermissionsByDirectory` 做
  session→directory 裁切;directory 未知时**保留**该条(宁可多拉一次,也不退回 fail-open)。未动 `sessionContent: false`。
- **第五处同族回归(本批新挖出)**:2026-06-12 `healClearedSessionOrphans` 的**调用点在同步时被冲掉**,
  `bootstrap.ts` 只剩悬空 import。上游重写接管了第 ① 半(清残留 busy),第 ② 半无等价物 → 调用点补回、数据源随迁全局。
- 顺带:`deriveSessionWorking` 声明进 Logic 清单却**零测试**,补 8 条。

### S5 · 预览器收起 + 动画(REQ-111)

- 新增顶部 tab 收起入口(经典 + v2 共用纯函数 `session-tab-collapse.ts`)。**不复刻**依赖 Kobalte
  `onChange` 隐式行为的旧链路。
- ⚠️ 施工中被上游 `file-browser-sidebar-tab-switch` e2e 抓到**两次**:
  ① 先在 `previewTab` 里做收起 → 打断 v2「双击开永久 tab」→ 回退该入口;
  ② 快照用 `mousedown` 仍不够早 —— Kobalte 在 **pointerdown** 就切激活态,导致每次切 tab 都误收面板。
  改**捕获阶段 pointerdown** 才对。两条都写进注释与测试。
- 文件树入口按计划退出条款不动,改为让 **tooltip 与实际可用性对齐**(只在 toggle 真能用的经典布局显示)。
- 动画恢复 flex-grow/flex-basis 反向驱动(360ms);stacked 布局主轴是列,保留显式 width;
  v2 圆角/阴影与 `md:order-first` 一个没动。

### S9 · LaTeX(REQ-115)

先收口两份**逐字重复**的 `katexExtension`(marked-parser 导出、marked.tsx 引用),再扩规则:
`$…$` 行内(四条货币护栏)+ `\[…\]`(同行/跨行)+ 同行 `$$` + ≤3 空格缩进。
死代码 `renderMathInText`/`renderMathExpressions` **保留但标注**(唯一调用点的 `nativeParser` prop 全仓零传入;
删掉等于砍上游 API 面)。

## R4 override 复核报告(仅 S9 一笔)

**触动黑名单**:`packages/ui/src/context/marked-parser.tsx` / `marked.tsx`(+ 新增测试 `marked-katex.test.ts`)。

1. **wrapper 不可行性**:marked 扩展必须经 `.use()` 注册到**各自的 parser 实例**上;
   `createMarkdownParser`(worker)与 `jsParser`(marked.tsx)是两个独立实例,包外无注入点。
   而本条的核心动作恰恰是**把两份重复定义收口成一份** —— 这在定义所在文件之外无法完成。
   先例:`96c9e50ddf`(chat-tilde-del-fix,同样 ui/web 两实例各注册一次)、`2a60c849b8`(旧 shell 折叠)。
2. **风险评估**:改动集中在 katex tokenizer 规则,不触碰同链其它扩展(alert / footnote / mark / emoji /
   shiki / mermaid / strictDel);16 条矩阵 × 2 路径 + 6 条护栏负例锁住"该渲染的渲染、该保持裸文本的不动";
   ui 包 83 全绿、markdown 相关 e2e 21 全绿。最坏情况(某种未覆盖写法误命中)表现为公式误渲染,
   不影响数据与发送链路,可单笔 revert。
3. **改动论证**:见上「S9」段 + 代码内 FORK-BEGIN 注释。
4. **配额**:本季第 1 笔(按 commit 计)。S3 原本也需要 override,通过「文案由 app 侧传入」的设计**规避掉了**。

## 验证结果(自动化部分,全绿)

| 项 | 结果 |
|---|---|
| typecheck(fork 范围) | 29/29 |
| app 单测 | 1045 pass / 0 fail(135→136 文件) |
| session-ui 单测 | 105 pass / 0 fail |
| ui 单测 | 83 pass / 0 fail |
| e2e regression + smoke | **138/138 pass**,上游断言零改动 |
| `check-child-store-reads.sh` 闸 | 零违规命中 |
| e2e performance 组(`OPENCODE_PERFORMANCE=1`) | 60 pass / **5 fail —— clean tree 同样失败,既有问题非本批引入**(见下) |
| **GUI · 本批专项 CDP 断言** | **12/12 pass**(真实打包产物 + 真 Electron) |
| **GUI · smoke.py panels/settings/boot** | **13/13 pass** |
| **GUI · smoke.py files(文件预览)** | 5 pass / 1 WARN(既有图片渲染告警,非本批范围) |

新增测试:S8 5 条 / S1 10 条 / S3 8 条 / S7 15 条 / S4 8 条 / S6 4 条(复现用例翻成验收) /
S5 7 条单测 + 2 条 e2e / S9 35 条;另 S3 3 条 e2e、S7 4 条 e2e。

**e2e fixture 注入点实为三处**(原计划待钉死项只列了两处):`mock-server.ts` / `timeline-stability/fixture.ts` /
`smoke/session-timeline.spec.ts` 自带的 `settings.v3`。三处都只种默认值,**断言零改动**。

## GUI / 端到端自动化(2026-08-18 已跑)

**跑法**:`OPENCODE_CHANNEL=local` 起真 Electron 加载打包产物(`electron-vite build` 出的 `out/`),
带 `--remote-debugging-port=9222`,全程 CDP 定点驱动(不用全局鼠标坐标,不会误触别的窗口)。
local 档独立身份 + `opencode-local.db` 数据隔离,**user 的正式版全程未被触碰**(测前 7 进程、测后仍 7 进程)。

**本批专项断言**(新增 `packages/branding/smoke/req108_batch_gui_check.py`,12/12):
- S1 进度条四条 CSS 规则(keyframes / 容器 / **淡出态** / bar)确实进了打包产物
- S9 KaTeX 样式进了产物(公式出图前提)
- S1「显示会话进度条」、S3「折叠 Shell 命令」两个开关在真设置面板里**渲染出来且默认开**
- 无全屏渲染崩溃页、无未捕获异常 / console.error

**现成冒烟**(`smoke.py`):panels 5 + settings 6(含飞书桥接页)+ boot reload = 13/13;
files 文件预览 5 pass / 1 既有 WARN。

⚠️ **副作用记录**:local 实例会加载 user 真实 `~/.opencode` 配置,启动时**把飞书桥也连上了**
(日志见 `[wss] connected: account=cli_…`)。测试窗口内理论上存在飞书消息路由到测试实例的可能。
本次测完即刻关停(CDP 端口已确认关闭)。**下次做 GUI 自动化前应先隔离配置目录**,
这条补进 `reference_deskfox_gui_automation` 的坑位清单。

## 🔒 真机人工验收(2026-08-18 user 已逐条确认通过)

user 在 local 版实测,以下全部通过:

- [x] S8:新会话 composer 无残留卡;切项目不回退
- [x] S1:任务执行期顶部进度条扫动、结束淡出;开关默认开且即时生效
- [x] S3:shell 命令默认折叠成「已运行 N 条命令」
- [x] S7:同文件连续编辑合并 ×N,文件名仍可见
- [x] S4:会话列表运行中图标亮起/熄灭正常
- [x] S5:点当前文件 tab 收起预览器;双击开永久 tab 未被误伤
- [x] S9:模型输出的公式出图,金额未被误吃

### 附:收起/展开动画对称性核查(user 2026-08-18 追问,已实测)

CDP 逐帧采样真实窗口,结论**分两种情况**:

| 场景 | 位移 | 耗时 | 结论 |
|---|---|---|---|
| 预览区展开(点文件树里的文件) | 240 → 640 px | **222 ms** | 对称 ✅ |
| 预览区收起(点已激活的文件 tab) | 640 → 240 px | **223 ms** | 差 1 ms |
| 整块侧面板展开(开文件树) | 0 → 240 px | ~190 ms | 有动画 |
| 整块侧面板全收(关文件树) | 240 → 消失 | **~60ms 直接卸载,无动画** | 不对称 ⚠️ |

- 前两条共用同一条过渡(`0.36s` + `cubic-bezier(0.22,1,0.36,1)`),侧面板与聊天区两条驱动链计算值一致,曲线互为镜像 → **本批 S5 的动画恢复达成目标**。
- 第 4 条的不对称源于上游 `session.tsx:2460` 的 `<Show when={desktopSidePanelOpen()}>`:review 与文件树都关时整个组件卸载,DOM 都没了,无退场动画可言。**该挂载门本批一行未动**(diff 零命中,最后改动是上游 `4f62295e44` 2026-07-27)。
- **user 2026-08-18 拍板:不改**。理由:只在手动关掉文件树时出现,日常关预览走的是对称那条;修它要动上游组件树结构,收益/风险不划算。若日后体感难受再单开需求。

## 待 user 拍板/知会(S2 报备闭环)

> 2026-08-18 已过一轮:真机验收 7 条全通过;动画对称性追问已查清并拍板「不改」(见上)。
> 下列 1-7 为仍需 user 明确表态的项。

1. **S3 单条 shell 也折叠**:实现与「已探索」组同口径(不搞特例)。若希望"只有 ≥2 条才折叠",是一行改动。
2. **S7 edit 合并只显示最后一次的卡片**:合并行渲染**最后一次**编辑(文件最新状态),中间几次的 diff
   不再单独成卡。这是 REQ-113 §2B 决策的直接结果,但确实是信息密度的取舍,提请确认。
3. **S5 文件树入口本批未做**:v2 下"再次点击文件树同一行收起"仍不可用(实测会打断双击开永久 tab)。
   已把 hover 提示改为只在经典布局显示,不存在「提示在、功能不在」。
4. **S9 已知边界**:表格单元格内含 `|` 的公式(`$|x|$`)受 markdown 表格语法固有冲突,规避靠 `\vert`;
   `\begin{equation|align|…}` 环境族属 REQ-115「档二」,首版不做。
5. **公式渲染失败仍是红字**(`throwOnError: false` 上游默认未改)。计划里倾向"回退成原始文本",
   施工时未观察到误命中,**保持现状**;真机若见红字再改。
6. **R4 override 本季第 1 笔**(S9),请确认。
7. **未 push 的 3 笔**(`f40f88d505` / `c86f3efa61` / `d79da924de`)随本批一并处理。

## 已知问题(非本批引入,建议单开)

- **e2e performance 组 5 条既有失败**(已用 clean tree 对照确认与本批无关):
  `timeline-stability/adverse.spec.ts` 2 条(shell 状态跨虚拟化保持 / 窄屏来回 resize 行序)、
  `timeline/` benchmark 3 条(home-tab 导航 / parent hydration / tab 切换)。
- **桌面打包链路两处环境阻塞**(与代码无关):`prebuild` 要下的
  `@opencode-ai/cli-darwin-arm64@0.0.0-next-16350` 在 registry 已取不到(本地 `resources/opencode-cli`
  是 8/14 旧物);`electron-builder --mac --dir` 两次都在下载环节 600s 超时(Electron 本体已缓存)。
  故本次 GUI 验证走「真 Electron 直接加载 out/」而非 `.app`,renderer/main 产物是同一套。

- `packages/app/src/components/prompt-input/submit.test.ts` **加载即挂**(`Export named 'toaster' not found`),
  clean tree 同样失败 → 该文件当前零覆盖。
- 4 个 i18n 文件 CRLF 污染(`da`/`de`/`no`/`tr`),建议加 `.gitattributes` 归一化。
- 23 个死 i18n key(`fileTree.dialog.*` / `settings.feishu.*`),sync 前就死了。

## 回退方法

每批一笔 commit、互不依赖(S7 依赖 S3 的分组扩展点,回退需连带):
`git revert <hash>` 即可。整批回退:`git revert c5dc1aeb41 0442721164 6fa866a355 30401b81ea 33fc92c056 557d151890 aad041be77`。
