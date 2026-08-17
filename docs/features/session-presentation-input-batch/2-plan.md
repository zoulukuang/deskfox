feat-id: session-presentation-input-batch
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 会话呈现与输入修复批 — 2-plan(实施计划)

> 状态:**spec(待 user 审签 1-spec 后开工)**。锚点均已于 2026-08-17 对 HEAD `d79da924de` 核实(勘误见 1-spec §7)。
> 开发中的踩坑 / 方案推翻按规范实时追加在本文件末尾「决策轨迹」。

## 1. 分支与 commit 策略

- **单一 feat 分支 `feat/session-presentation-input-batch`** 承载全批(本文档所在分支),批内按 P4「一 commit 一件事」逐批推进;整批 R9 验收全绿后一次性向 user 提 merge。
  - 理由:第 1/2 批共用 `settings.tsx` + 两个设置面板,拆分支必然互相 rebase;批间顺序依赖(S7 依赖 S3 的分组扩展点)也天然适合单分支串行。
  - 若 user 想分批合 main(如第 0 批 S8 先行止血),从本分支 cherry-pick 对应 commit 单独开短命分支提 merge 即可,不重构。
- commit tag 统一 `[feat: session-presentation-input-batch]`;S6 的 commit 在 message 正文注明承接 `[feat: permission-filter-concurrency]` 的复现单测(`f40f88d505`),保 grep 链路。
- 修 bug 类子项(S8/S4/S6/S5-toggle)按 R5 带 `[bug-repro: …]`,复现测试与 fix 同 commit(S6 的复现测试已先行落库,fix commit 引用之)。
- 黑名单预警:S3/S7 动 `packages/session-ui/`、S9 动 `packages/ui/` —— 若命中黑名单文件,按 R4 走 override(参照 `chat-tilde-del-fix` 先例:ui 路径 R4 已有获批先例);S1/S4/S5/S8 在 `packages/app/` 常规面,预期无 R4。开工时逐文件对 `docs/governance/改动规则.md` 黑名单核一遍再动手。

## 2. 批次划分(按「抢不抢同一片代码」排,非按需求号)

| 批 | 子项 | 为什么放一起 | 预计规模 |
|---|---|---|---|
| 第 0 批 | S8 上下文卡泄漏 | 在漏数据且最便宜;文件面(`prompt-input/`)与后面零重叠 | 很小(1–2 小时) |
| 第 1 批 | S1 进度条 | 三块纯搬运 + 一块落位 | 小(半天内) |
| 第 2 批 | S3 shell 折叠 → S7 噪声治理 | 与 S1 共用 settings 面;**S7 必须紧跟 S3**(同一 `message-part-grouping.ts`,S7 在 S3 分组扩展点上继续加) | 中 |
| 第 3 批 | S4 运行中图标 → S6 权限过滤层 | 同一个模子(child store 直读);一起改一起验,改完跑闸 | 中 |
| 第 4 批 | S5 预览器收起 + 动画 | UI 结构动得最多,单独一批,避开与 S1 抢 session 布局代码 | 中偏大 |
| 第 5 批 | S9 LaTeX | 只动 `packages/ui/src/context/marked*.tsx`,与全部子项不抢文件;纯解析层 | 中(含收口重构) |
| 收尾 | S2 报备闭环 | 前五批可感知变化攒一起,一次性向 user 过 | 小 |

## 3. 逐批实施步骤(锚点已核实)

### 第 0 批 · S8(REQ-116)

1. **先补单测钉现状(红灯)**:`submission-state` 纯逻辑——构造 initial(workspace scope)+ target(新 session scope),`retarget` → `clear`,断言 initial 的 `context.items` 为空。**先看它红**再改码。
2. **改 clear 语义**:`packages/app/src/components/prompt-input/submission-state.ts:18-21`,initial ≠ target 时对 initial 也清 context items(与 `initial.reset()` 同批);**不改** `prompt-state.ts` 的 `reset()`。
3. **核失败恢复**:`submit.ts` `restoreInput`(`:493`,调用 `:535/:569/:603/:665`)/ `restoreCommentItems`(`:308`)恢复到 `submission.target()`——确认发送失败时卡片仍可恢复。
4. **同类波及**:新会话态裸文件附件卡一并验;现有会话流(target == initial)上游语义不动。
5. **自验**:单测转绿 + 🔒 真机复现路径 + 切项目确认不回退。
6. **回贡备忘**:按 REQ-071 路线开 upstream PR,记 changelog,不阻塞。

### 第 1 批 · S1(REQ-108)

1. **搬 CSS**:基准 `git show e77443750e:packages/app/src/index.css`(`:315` 起四块:keyframes / session-progress / hiding 态 / progress-bar)原样进 fork 同文件 `@layer components`。零判断,先做完。
2. **加设置字段** `showSessionProgressBar`(默认 `true`,字段名沿用基准):`context/settings.tsx` 照 `shellToolPartsExpanded` 三处(`:33/:214/:426-431`)抄。
3. **加设置开关**:`components/settings-general.tsx:392` 与 `components/settings-v2/general.tsx:349` 附近各一行 `SettingsRow(V2)` + `Switch`;i18n 只补 zh+en:`settings.general.row.showSessionProgressBar.{title,description}`。
4. **落渲染点**(唯一动脑步):在 `src/pages/session/timeline/message-timeline.tsx` 找 sticky 会话头等价节点,渲染基准 `message-timeline.tsx:1400-1409` 块;`workingStatus` 三态 memo(基准 `:336-341`,含 `timeoutDone` 信号)——新 timeline 若已有等价「会话在跑」信号(如 tab 指示器的 `state.loading()`)就复用,没有就连 memo 带信号一起移植。**220ms 淡出态别丢**。
5. **自验**:深浅主题 × 开关开/关 + 🔒 真跑 >10s 任务。

### 第 2 批 · S3(REQ-109)→ S7(REQ-113)

1. **加设置字段** `shellToolPartsGrouped`(**产品默认 `true`**),位置同 S1 第 2 步。
2. **改分组**:`packages/session-ui/src/components/message-part-grouping.ts`(`groupParts:56` / `flush:60`)按已拍板的**独立「已运行 N 条命令」组**实现;文件头的撤销记录注释**更新成本次决策记录,别删历史**。
3. **补摘要计数**:`message-part.tsx` `contextToolSummary(:813)` 与 `AnimatedCountList` 加 command 项;i18n 复用现成孤儿键 `ui.messagePart.context.command.{one,other}`(`zh.ts:104` / `en.ts:111`),不用新翻。
4. **e2e 种默认(两处都种)**:① `e2e/utils/mock-server.ts:55-58` 照 `newLayoutDesigns: false` 写法补 `shellToolPartsGrouped: false`;② `e2e/performance/timeline-stability/fixture.ts` 的 `setupTimeline` 独立注入点(`:128-144`,已支持 settings 参数)同样种上。**不改任何断言**。
5. **单测**:两套口径各一组 + 锁「产品默认是 grouped」。
6. **自验**:上游 shell 族八文件 e2e 全绿断言零改动 + 🔒 真跑 10+ 条 shell 任务。
7. **S7 · 合并连续 `invalid`**:在 `flush` 骨架上加组类型,聚成「7 次无效调用」一行,展开复用 `basic-tool.tsx` `GenericTool(:323)`。
8. **S7 · 同文件连续 `edit`/`write` 合并**:合并键 `input.filePath`,标题 `getFilename(...)`(照 `message-part.tsx:537/:543`),呈现 `编辑 xxx.py ×4`。⚠ edit 不进折叠组;`patch` 首版留后。
9. **自验**:连续/间隔/混合序列单测 + edit 单次独立成行 + 🔒 真跑多次同文件编辑任务。

### 第 3 批 · S4(REQ-110)→ S6(REQ-112)

1. **先实测,不改码**:真跑会话上打日志,看 `serverSync().child(dir)` 的 `session_status[id]` / `message[id]` 有没有值。
2. **按实测改数据源**:`pages/layout/sidebar-items.tsx` `isWorking` memo(`~:187-193`)的两个输入 child → 全局 session store,或直接采上游 `session_working(id)`(`context/server-session.ts:207`)。取舍按决策树:`context/global-sync/session-status-reconcile.ts` 的 reconcile 在**重连/重启路径都触发** → 采上游口径,归档 2026-06-06 `deriveSessionWorking` 纯函数及其单测;有缺口 → 保留纯函数只换数据源。**防卡死语义必须保住**。
3. **S6 同批改**:`context/permission.tsx:442` `ensureResolvableTracked` 改读全局 permission(形状 `{[sessionID]: PermissionRequest[]}`,无 directory 维度)→ 经 `serverSync.session.get(id).directory` 映射按 directory 过滤;**不动 `sessionContent: false`**。既有复现单测 `permission-resolvable-source.test.ts`(4 例)转绿即验收。
4. **跑闸验收**:`bash packages/app/scripts/check-child-store-reads.sh` 零违规命中(闸已随 `f40f88d505` 落库,无需再建)。
5. **自验**:多会话并行不误亮/漏亮 + 硬杀/断连不残留 + 🔒 真跑长任务全程盯列表。

### 第 4 批 · S5(REQ-111)

1. **tab 点击收起(必做)**:`components/session/session-sortable-tab-v2.tsx` Trigger 上**显式**加「点击已 active → 收起面板」(不依赖 Kobalte `onChange` 同值点击行为);经典侧 `session-sortable-tab.tsx` 同步。
2. **恢复动画驱动**:`pages/session/session-side-panel.tsx:365-380`,从 `transition-[width]` + 显式 width 改回基准(`e77443750e` 同文件 `:283-294`)的「唯一可伸长项 + `transition-[flex-grow,flex-basis] duration-[360ms]`,flex-grow 0↔1 / flex-basis 0px」。⚠ 同段 classList 的 v2 圆角/阴影/`bg-v2-*` 与 `md:order-first`(mirror-layout-overflow)一个不能冲掉。
3. **文件树入口 + tooltip 一致性**:tab 做完后评估文件树「再次点击收起」在 v2 单击/双击窗口里的时序判别(门控在 `session-side-panel.tsx:204` `isViewerOpen`);**评估 >1h 就不做,但必须同时摘 tooltip** `fileTree.collapsePreviewHint`(`components/file-tree.tsx:348`)。
4. **自验**:v2 双击开永久 tab 不误伤 + 上游 file-browser e2e 全绿 + 经典布局不回退 + 🔒 真机确认动画方向。

### 第 5 批 · S9(REQ-115)

1. **先收口再扩规则**:两份逐字重复的 `katexExtension`(`marked-parser.tsx:23` / `marked.tsx:482`)合成一份——`marked-parser.tsx` 导出、`marked.tsx` 引用。
2. **`$…$` 行内 + 货币护栏**:采已实测正则 `/\$(?![\s$])((?:\\.|[^$\\\n])*?)(?<!\s)\$(?!\d)/` 起步;四条护栏 + `\$` 转义不参与配对。
3. **`\[…\]` 块级(同行+跨行)**:tokenizer `start()` 在 markdown 转义前拿位置;拿不到退 `preprocess`/`walkTokens`,不得影响同链其它扩展。
4. **放宽 `$$`**:允许同行 `$$…$$` + 前置 ≤3 空格缩进。
5. **清死代码**:`marked.tsx` `renderMathExpressions(:529)` / `renderMathInText(:447)` 仅 `props.nativeParser` 分支调用且该 prop 全仓无传入点(已核)——删或标注。
6. **测例**:`marked-parser.test.ts` 落 14 条矩阵 + user 样例 + 货币负例 + 代码块隔离;**两条渲染路径各跑同一组矩阵**。
7. **自验**:🔒 真机混排段肉眼确认。

### 收尾 · S2(REQ-108)

1. 清单落本 feat 目录(建议 `4-s2-audit.md`):每条含基准位置 / 当前状态 / 失效模式(丢失 / 主动撤销 / 判定失效 / 条件关掉)/ 可感知 / 建议+理由;第一轮结果(2026-08-15 六维排查,5 维已排除)从 OPENCODE-PLAN 计划搬入定稿。
2. **报备闭环**:前五批可感知变化 + 清单可感知项,当面向 user 过一遍并记拍板。
3. 顺带核 REQ-103 状态漂移(需求总览 ⬜ vs 实际已随 2026.10.0 交付),确认后走归档。

## 4. 施工中待确认项(非阻塞,随手钉)

1. 【S1】新 timeline(`timeline/message-timeline.tsx`)sticky 会话头等价节点在哪 —— 认代码定落位。
2. 【S1】新结构里有无现成「会话在跑」信号可复用(避免重复移植 memo)。
3. 【S4】第一步实测结果(child store 到底空不空)→ 走决策树哪条腿。
4. 【S4】`session-status-reconcile` 在重连 / 重启路径是否都触发(决定归档还是保留 2026-06-06 纯函数)。
5. 【S8】新会话态裸文件附件卡实测是否同样泄漏(理论同路径)。
6. 【S9】`\[` 转义时序:tokenizer `start()` 能否在转义前拿到位置;不能则退路方案。
7. 【S9】公式渲染失败呈现:红字 vs 回退原文(倾向后者),看实际观感定,记 changelog。
8. 【S3/S9】黑名单逐文件核对(`session-ui` / `ui` 路径),命中则按 R4 走 override 流程。

## 5. 风险与回退

- **每批独立可 revert**(P4):批内 commit 自洽,单批出问题 revert 该批 commit 即可,不牵连他批。
- **S4 最大风险 = 推断错根因**:故第一步强制实测;若 child store 实际有值(推断错),回到日志现场重新定位,不动代码。
- **S5 最大回归面 = v2 双击语义**:上游 file-browser e2e 是硬闸;动画改动若与 v2 样式冲突,优先保 v2 样式、动画降级为 width 过渡并记录。
- **S9 误命中风险**:货币负例 + 「该保持裸文本的也锁住」的反向断言是主防线;失败呈现回退原文兜底。
- **e2e 基线**:S3/S5 依赖的上游 e2e 套件在改动前先跑一遍拿绿基线,避免把环境型假失败(见 memory `reference_local_test_env_false_failures`)误判为回归。

## 决策轨迹(开发中实时追加)

- 2026-08-17 文档化:由 OPENCODE-PLAN `需求计划/2026-08-14-2.md` 转成本三文档;全锚点核实 + 8 处勘误(1-spec §7)。**暂不开发,待 user 审签。**
