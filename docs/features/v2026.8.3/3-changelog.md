feat-id: v2026.8.3
status: in-progress
related: ../../../../OPENCODE-PLAN/版本计划/v2026.8.3.md (1-spec 等价物) ./3-changelog.md

# v2026.8.3 — changelog

## 一句话

供应商/模型连通性修复批 + GUI 残余补丁:4 个根因已钉死的问题 —— 供应商列表不刷新、自定义模型幽灵、检查更新重复框、Build 摘要行位置错误。版本级交付(U1–U4),走 phase1→phase2 模块流水线 + 主控收尾。

> Large:17 文件 / +983 −60 行 / 触动上游 `packages/ui/message-part.tsx`(FORK marker)/ 1-spec 等价物 = OPENCODE-PLAN 版本计划(范围已锁、根因钉到 file:line)。
> **状态 in-progress**:全部单元代码 + 测试就绪并验收过,**未 push、未合 main**(铁律②③)。

## 单元与 commit 列表

| 单元 | REQ | 内容 | commit |
|---|---|---|---|
| ~~**U1**~~ | ~~REQ-066~~ | ~~Build 摘要行从 text part 尾部 copy-wrapper 抽出 → 首个 text part 正文前 + Collapsible 默认收起~~ **已撤销**(理解有误,见 U5) | ~~`f2ee59a387`~~ ~~`fb09caa905`~~ · revert `<本笔>` |
| **U5** | shell-折叠 | bash/shell 工具纳入「已探索」折叠组(默认收起、点击展开),消除 Claude Code 回合下方 shell 竖向铺开;替代被撤的 U1 | `<本笔>`(R4 override) |
| **U2** | REQ-052 | 供应商连接/断开后 providers query 强制失效:暴露 `refreshProviders()` 并在 `complete()`/`disconnect()` 调用 | `b78e87ea52` feat · `939e940bd7` 验收1轮 · `6d5be64d7a` 单测迁 event-reducer · `acadcc13e7` 验收锚点对齐 v1 |
| **U3** | REQ-054 | `mergeGetbotModels` 纯函数 + 脚本档补写回 + 应用内「刷新模型」按钮(清幽灵模型) | `fb8f2a8036` feat · `067cbb96cc` data-component override · `21f5628bf0` 验收2轮 · `1db9454e95` 验收3轮收尾 · `82b9ac26ba` e2e 改测 v1 |
| **U4** | (检查更新弹重复框) | 收敛 `layout.tsx` 双 ToastRegion 为单一 region(Kobalte toast 单例被两 region 各渲一遍 → 每条 toast 翻倍) | `6302e2a8dd` feat |

## 各单元详情

### ~~U1 REQ-066 — Build 摘要行位置 + 默认收起~~(已撤销)

> **2026-06-19 user 复核后撤销**:REQ-066 原始理解有误——它只把 Build meta **一行**挪到正文上方+折叠,但 user 真正诉求是 Claude Code 回合的**思考/工具整段**对齐 DeskFox 原生(上方+收起),那是另一条需求(`思考链显示顺序-reasoning在正文下方.md`,未做)。U1 改了也不解决 user 看到的「最终答案下方一大堆 shell 铺开」,故整体撤回。
>
> **撤销内容**:`message-part.{tsx,css}` 还原到上游(0 fork 侵入),删 `build-meta-above-body-v2026.8.3.spec.ts`。原根因/改法记录见 git 历史 `f2ee59a387`。

### U5 shell-折叠 — bash 工具纳入「已探索」折叠组(替代 U1)

- **诉求**:Claude Code 回合里最终答案下方铺着 20+ 个独立 shell 行(每行一条命令,竖向拉很长)。要把它们默认收起、点击才展开。
- **根因**:原生「已探索 N 次」折叠组只收 `read/glob/grep/list`(`CONTEXT_GROUP_TOOLS`),`bash` 不在内 → 每条 shell 单独成行。单个 shell 工具本就默认收起(`shellToolPartsExpanded:false`),问题是**条数铺开**不是单条展开。
- **改法**(复用原生折叠机制,零新组件):① 把纯分组逻辑(`groupParts`/`isContextGroupTool`/`CONTEXT_GROUP_TOOLS`/`PartGroup`)抽到 fork-only 新文件 `message-part-grouping.ts`(原文件 import client-only 组件、bun 单测加载即抛,helper extract → Logic 清单),`CONTEXT_GROUP_TOOLS` 加 `"bash"`;`message-part.tsx` 改为 import + re-export 保持对外 API 不变。② `contextToolSummary` + `ContextToolGroup` 的 `AnimatedCountList` 加「命令」计数项;i18n `ui.messagePart.context.command.one/other`(ui en/zh)。
- **作用范围**:全局(所有模型的连续 shell 都折叠,一致;DeepSeek/Claude Code 同款)。**非单一大折叠**——交错的 `bash→思考→bash` 会折成多个连续段各一个收起组(比 20 行散开好很多,整段大折叠属更大的`思考链显示顺序`需求)。
- **文件**:`message-part-grouping.ts`(新,+96,fork-only)、`message-part.tsx`(import/re-export + 计数项)、`message-part.test.ts`(+3 折叠测试)、`i18n/en.ts`/`zh.ts`(+2 key each)。
- **R4 override**:5 文件全在 `packages/ui/`(路径型黑名单,含 fork-only 新文件误伤),已复核(wrapper 最大化隔离、剩余触点不可外置、低风险)。见 `改动日志.md`。

### U2 REQ-052 — 供应商连接/断开后列表实时刷新

- **根因**:连/断供应商后未失效 providers query,列表 + 模型选择器不刷新。
- **改法**(布局无关,核心在数据层):`server-sync.tsx` 抽出纯函数 `isProvidersQueryKey` + 暴露 `refreshProviders()`,在 `complete()`(连接成功)/`disconnect()` 收尾调用强制失效;单测落 `event-reducer.test.ts`。
- **验收锚点对齐发货布局(`acadcc13e7`)**:DeskFox 默认 v1 经典布局(`newLayoutDesigns=false` + FORK 隐藏 v2 开关),用户永远看不到 settings-v2。原 e2e 锚点(`data-provider-id`/`data-empty-state`)只加在 v2、spec 用 `enableNewLayout` 强开 v2 = 测了不发货的布局。修法:把锚点对齐补到 v1 `settings-providers.tsx`(`connected-providers-section` v1 原有),e2e 去掉 `enableNewLayout`、`dialog-v2`→`dialog`、走 v1 `role=tab Providers` 路径。功能逻辑零改动。
- **文件**:`server-sync.tsx`(+18)、`event-reducer.test.ts`(+27)、`settings-providers.tsx`(v1,补锚点)、`settings-v2/providers.tsx`(v2,补锚点)、`e2e/regression/providers-refresh-v2026.8.3.spec.ts`(+114)。
- **本地版真机 CDP 实测**:v1 供应商面板 4 个已连供应商(alibaba-cn/xiaomi/getbot/claude-code)全部渲出 `data-provider-id` 锚点。

### U3 REQ-054 — 自定义供应商模型列表同步(清幽灵)

- **根因**:getbot 自定义供应商模型列表无自动同步,残留幽灵模型致 503。
- **改法**:`getbot.ts` 加 `mergeGetbotModels` 纯函数(+12 单测)+ 脚本档补写回 config + 应用内「刷新模型」按钮(仅 getbot 行显示,`data-component="getbot-refresh-models"` 锚点放外层 wrapper span,避开 Button 根硬编码 data-component 不可覆盖,沿用 U1 wrapper 方案、避免改上游)。
- **越界回撤**:第3轮验收时修复 agent 一度改上游 `button.tsx`,主控收尾撤回改用 wrapper-span 锚点;modalities 类型对齐 SDK 结构体修 6 个 typecheck error;e2e 去除 mock 给不出 apiKey 的成功-toast 不可达用例。
- **e2e 改测 v1(`82b9ac26ba`)**:与 U2 同病,getbot-model-sync spec 原测 v2;组件零改动(v1 的刷新按钮 + 锚点本就存在,`data-provider-id` 由 U2 补到 v1),只改 spec 去 `enableNewLayout`、走 v1 路径。
- **文件**:`getbot.ts`(+42)、`getbot.test.ts`(+128)、`dialog-connect-provider.tsx`(+9)、`settings-providers.tsx`/`settings-v2/providers.tsx`(刷新按钮)、i18n en/zh/zht(+4 each)、`e2e/regression/getbot-model-sync-v2026.8.3.spec.ts`(+150)。

### U4 — 检查更新弹重复框(硬化方案)

- **根因**:legacy `Toast.Region` 与 v2 `ToastV2.Region` 共用同一 Kobalte toast 单例;`layout.tsx` 在 `Show` 分支内各渲一个 region,分支切换瞬间两 region 共存 → 一条 toast 被渲两遍(「每点必双」)。
- **改法**:`ToastRegion` 挪到 `Show` 之外单一渲染(按 `newDesign()` 切 v1/v2 region),`UpdateAvailableToast` 同步移到 `Show` 外两 design 共用 → 全局任意时刻恰好 1 个 `[data-component="toast-region"]`。
- **文件**:`layout.tsx`(+50/−…)、`e2e/regression/single-toast-region-v2026.8.3.spec.ts`(+147,legacy + v2 两布局各验 1 toast)。
- **本地版真机 CDP 实测**:DOM 恒 1 个 toast region。动态「检查更新」触发本地版无 updater 端点(local 永不发布、按设计无更新源)点不动,结构层 + e2e 已覆盖。

## 回归测试

- **集成终关**:turbo typecheck 22/22 · app 459 pass · ui 30 pass · e2e 回归 17 pass · 0 fail。
- **v1 对齐两笔**:providers-refresh 2 pass(v1)· getbot-model-sync 2 pass(v1)· regression 全套 17 pass · app typecheck 通过。
- **U5 撤U1+shell折叠**:typecheck 26/26 · ui 单测 33 pass(含新增 3 个 `groupParts` bash 折叠测试)· e2e 回归 16 pass(撤 U1 删了 build-meta spec,17→16)· 0 fail。

## 影响范围 / 上游侵入

- 净改动 17 文件 / +983 −60。
- U1 撤销后 `message-part.{tsx,css}` 还原上游;U5 重新触及它们(import/re-export + 计数项)+ ui i18n en/zh + 新 fork 文件 `message-part-grouping.ts` —— 5 文件全在 `packages/ui/`(路径型黑名单),走 **1 笔 R4 override**(本季首笔)。U3 一度越界改上游 `button.tsx` 已撤回换 wrapper-span。
- 其余全 fork-only(`packages/app/`)。

## 回退方法

逐单元 commit 可独立 `git revert`(P4);整版回退 `git reset --hard main`(feat 分支未合 main)。

## 待办

- 真桌面 QA:U4 动态「每点必双」需带 updater 的包(dev/prod)真机点「检查更新」确认只弹一框;视觉对齐(Build 折叠头外观)真机验。
- push `feat/v2026.8.3` / 合 main 待 user 拍板。
