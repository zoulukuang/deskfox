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
| **U1** | REQ-066 | Build 摘要行从 text part 尾部 copy-wrapper 抽出 → 首个 text part 正文前 + Collapsible 默认收起 | `f2ee59a387` feat · `fb09caa905` 清死样式补 acceptance |
| **U2** | REQ-052 | 供应商连接/断开后 providers query 强制失效:暴露 `refreshProviders()` 并在 `complete()`/`disconnect()` 调用 | `b78e87ea52` feat · `939e940bd7` 验收1轮 · `6d5be64d7a` 单测迁 event-reducer · `acadcc13e7` 验收锚点对齐 v1 |
| **U3** | REQ-054 | `mergeGetbotModels` 纯函数 + 脚本档补写回 + 应用内「刷新模型」按钮(清幽灵模型) | `fb8f2a8036` feat · `067cbb96cc` data-component override · `21f5628bf0` 验收2轮 · `1db9454e95` 验收3轮收尾 · `82b9ac26ba` e2e 改测 v1 |
| **U4** | (检查更新弹重复框) | 收敛 `layout.tsx` 双 ToastRegion 为单一 region(Kobalte toast 单例被两 region 各渲一遍 → 每条 toast 翻倍) | `6302e2a8dd` feat |

## 各单元详情

### U1 REQ-066 — Build 摘要行位置 + 默认收起

- **根因**:`message-part.tsx` 的 `meta()`(agent+model+duration 拼装)硬编码渲染在 text part DOM 末尾的 copy-wrapper 内,且 CSS `opacity:0` 仅 hover 显形 → 默认根本看不见、且在正文下方。
- **改法**(对齐 reasoning 折叠样板):`TextPartDisplay` 里 meta 行从尾部抽出,新增 `isFirstTextPart` 判定,在首个 text part 正文前插入 `Collapsible`(默认收起、`data-component="build-meta"`/`build-meta-trigger` 复用 `tool-collapsible` 样式),原 copy-wrapper 删 meta span 避免重复;`message-part.css` 删除随之失效的死样式。
- **文件**:`packages/ui/src/components/message-part.tsx`(+41/−4,上游文件,FORK marker)、`message-part.css`(−4)、`e2e/regression/build-meta-above-body-v2026.8.3.spec.ts`(+92)。
- **本地版真机 CDP 实测**:`build-meta-trigger` 默认 `aria-expanded=false`(收起),点击 true↔false 来回切换正常。

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

## 影响范围 / 上游侵入

- 净改动 17 文件 / +983 −60。
- 上游文件仅 `packages/ui/src/components/message-part.{tsx,css}`(U1),均带 FORK marker;U3 一度越界改上游 `button.tsx` 已撤回换 wrapper-span。
- 其余全 fork-only(`packages/app/`)。0 R4 override / 0 黑名单。

## 回退方法

逐单元 commit 可独立 `git revert`(P4);整版回退 `git reset --hard main`(feat 分支未合 main)。

## 待办

- 真桌面 QA:U4 动态「每点必双」需带 updater 的包(dev/prod)真机点「检查更新」确认只弹一框;视觉对齐(Build 折叠头外观)真机验。
- push `feat/v2026.8.3` / 合 main 待 user 拍板。
