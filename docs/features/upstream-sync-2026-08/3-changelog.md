feat-id: upstream-sync-2026-08
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md ./6-windows-handoff.md ./7-windows-verification.md

# 改动日志 — 上游同步 2026-08(v1.17.4 → v1.18.16)

**规模**:Large(1281 上游 commits / 4 段 merge / 99 冲突文件,其中 76 带 fork 定制)
**分支**:`sync/upstream-2026-08-10` · **兜底 tag**:`pre-merge-upstream-2026-08-10`(= 动工时 main `e77443750e`)
**R4 override**:4 笔 merge commit 各标一次(上游整段合入,黑名单改动全部来自上游侧;spec D1-D5 已 user 审签)

## 一、四段 merge

| 段 | 上游切点 | merge commit | 主题 | 收口 |
|---|---|---|---|---|
| 1 | v1.17.8 `8716c4309a` | `ea3ea31315` | 会话时间线虚拟化重写 | 25 冲突,e2e 37/37 |
| 2 | v1.17.13 `1e73b76ea6` | `3faa8a76f4` | markdown → session-ui 搬家 | 42 冲突,e2e 48/48 |
| 3 | v1.18.4 `d36a2d8981` | `76c1340c11` | v2 默认翻转 + provider 对话框统一 | e2e 117/117 |
| 4 | v1.18.16 `550d1ffd24` | `c1909dbb92` | i18n 全球化 + 菜单/导航上游化 | e2e 123/123,单测 947/950 |

每段的定制重移植、撤销决策与踩坑逐条记在 [`2-plan.md`](./2-plan.md) 决策轨迹,此处不重复。

## 二、整体验收(spec §六 第二块)

打包 `-Env local`,产物 `packages/desktop/dist-deskfox/win-unpacked/DeskFox 本地版.exe`(220.8MB),
带 `--remote-debugging-port=9222` 真机 CDP 逐项验。**全程只杀本地版,user 的正式版 7 个进程未受影响。**

| 项 | 结果 |
|---|---|
| local 档打包 | ✅ 产品名「DeskFox 本地版」/ 版本 2026.9.1 / 公司 DeskFox / LibreOffice bundle 就位 |
| 身份与数据隔离 | ✅ appId `ai.deskfox.app.local`、userData 独立目录、LOCAL 徽标 |
| 冷启动健康检查 | ✅ **2 次有效 CLEAN**(无 error toast / JS 异常 / 致命 console) |
| 界面渲染 | ✅ v2 布局无崩溃 |
| 菜单 i18n | ✅ 全中文(文件/编辑/视图/转到/窗口/帮助 + 全部子项) |
| Fox Blue 主题 | ✅ 单测 3/3(随 OC-2 token 重同步);真机取色未验(控件在视口外) |
| 文件预览路径 | ✅ v2 会话页仍走 fork `session.tsx` → `SessionSidePanel` → `FileTabContent` → document-viewer |
| getbot 定制 | ✅ `settings-v2/providers.tsx` 保有 10 处 FORK,已连接行含 GetBot |

## 三、验收发现的问题 + 本轮修复

**发现**:上游 v2 是**整套新组件**(`settings-v2/` / `new-session/` / `prompt-input-v2`),
fork 定制留在 legacy 组件上 → v2 设默认后"代码还在、用户点不到"。真机逐项点出 7 项缺口。
e2e 123/123 全绿没抓到,因为用例多来自上游、断言上游语义。

user 2026-08-11 拍板:🔴 两项本分支修完再提 merge,其余 5 项立 **REQ-106** 独立跟进
(`OPENCODE-PLAN/需求池/v2换代-fork定制回植.md`)。

### 修复 1 — 创作模式(media-gen)入口回植 v2 composer

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/components/prompt-input/creation-submit.ts` | **新增**(fork-only):`submitCreation` 编排 + `resolveReferenceImage`(blob→dataUrl) | +88 |
| `packages/app/src/components/prompt-input/creation-submit.test.ts` | **新增**:9 单测(Logic 清单) | +100 |
| `packages/app/src/components/prompt-input-v2.tsx` | 创作档:`modelControl` 插槽换创作控件 + `MediaModeMenu` 常驻;`view.agent` 让位;`view.submit.onSubmit` 拦截到生成 | +50 |
| `packages/app/src/components/prompt-input.tsx` | legacy 改调同一 helper(消除双份逻辑) | −33 |

**零改上游**(R1 第 1 级):上游 v2 composer 只暴露 `modelControl` 一个插槽,全部注入走它 + fork 侧 controller。

### 修复 2 — 飞书桥接设置页回植 v2 设置对话框

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/components/settings-v2/dialog-settings-v2.tsx` | 加 feishu `TabsV2.Trigger` + `TabsV2.Content`,复用 legacy `SettingsFeishu` 面板 | +13 |
| `packages/app/src/components/settings-feishu.tsx` | 加 `data-component="settings-feishu"` 稳定锚点 | +2 |

### 守卫(防再次静默丢失)

`packages/app/e2e/regression/v2-fork-customizations.spec.ts`(**新增** 3 条,全部显式种 `newLayoutDesigns: true`):
T1 飞书 tab 可见且面板能渲染 / T2 v2 composer 有创作模式入口 / T3 设置 tab ≥6。
**反证做过**:临时撤掉 `<MediaModeMenu/>` → T2 立即红,恢复后绿。

同源问题连带修:`OPENCODE-PLAN/诊断工具/cold-start-health-check.py`(commit `c2f8956`)——
toast 迁 solid-sonner、项目入口改 `project-avatar-v2`;修前 `clicked project: False`(不触发 file.list
就抓不到启动期 500 race),修后两次冷启动均 CLEAN 且真点开项目。

## 四、回归测试

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --filter='!./packages/console/*'` | ✅ 全绿 |
| app 单测(`bun run test:unit`,带 fork 必需 `--conditions=browser`) | **956 pass / 3 fail** — 3 条 = 段4 记录的 Win/browser 基线红(纯上游 v1.18.16 同条件同红,REQ-105 口径);对比段4 的 947/950,增量正是新增 9 条 |
| media-gen | ✅ 140/140 |
| adapter-feishu-lark | ✅ 792/792 |
| session-ui | ✅ 86/86 |
| branding | ✅ 52/52 |
| ui(fox-blue) | ✅ 3/3 |
| e2e 全量 | ✅ **126/126**(`PLAYWRIGHT_WORKERS=4`,3.4 分钟) |

### e2e 并发数发现(重要,影响以后每次验收判读)

默认 workers = CPU/2 = **8**(本机 16 核)。在 user 正式版 DeskFox 常驻的日常状态下跑全量:

| 轮次 | 并发 | 结果 | 耗时 |
|---|---|---|---|
| 1 | 8(默认) | 12 failed | 9.1 min |
| 2 | 8(默认,已停 local 版) | **14 failed,失败集合与第 1 轮几乎无交集** | 10.2 min |
| 3 | 4 | **126/126 全绿** | **3.4 min** |
| 对照 | 1(串行,只跑前两轮失败的 spec) | 全绿(7/7 + 21/21) | — |

失败集合**每轮都不同**且串行全绿 ⇒ 是并发资源竞争导致的超时,不是功能回归。
8 workers 比 4 workers **还慢 3 倍**(自相拖累),说明这台机器上默认并发已经过度。
**结论:本机跑全量 e2e 一律带 `PLAYWRIGHT_WORKERS=4`**;拿默认 8 跑出来的红,判读前先降并发复验。
(是否把默认值写进 `playwright.config.ts` 留 user 定,本轮未擅自改。)

## 五、用户可感知的变化(合 main 前须知)

1. **整体界面换代到 v2**(D1 已审签):设置页 / 模型选择 / 各弹窗 / review 面板 / 首页全部新样式。
2. **连续 shell 调用的呈现变了**:从「收进 Exploring 折叠组」变回「独立卡片(默认收起)」——
   段3 撤销 fork 的 bash 折叠组(上游新增 10+ 条 e2e 全断言 bash 独立成行,继续保留 = 每次 sync 长期改写上游 spec;
   且上游 v2 已用 `shellToolPartsExpanded` 默认收起解决同一痛点)。
3. **两个真 bug 顺带修好(用户可感收益)**:侧栏不再周期性整块重挂(打开的右键菜单不会自己消失)、
   排序 tick 不再触发无谓重排。
4. **仍待修的 5 项**(REQ-106,不阻断可用性):匿名统计开关、「高级」分组重新暴露、
   版本牌显示上游 semver、首页 opencode 水印、smoke.py 探针失效。

## 六、回退方法

- 单段回退:`git revert -m 1 <该段 merge commit>`(四段各自独立)。
- 整体回退:分支未合 main 前对 main 零影响;已合则回到 tag `pre-merge-upstream-2026-08-10`。
- 本轮两项回植可单独 revert(纯 fork 文件 + 一处 fork-only 新文件,不牵动上游代码)。

## 七、Mac 端接力收口(2026-08-12)

Win 端把分支推到 `origin` 后转 Mac 接力。本段是 Mac 侧做的两件事,均在本分支内完成。

### 7.1 合入 main(commit `1b67d53bdf`)

分支自 2026-08-10 `e77443750e` 分叉后,main 侧推进了 **11 笔** Mac 发版相关 commit。合入后分支基线与 main 对齐。
**零冲突** —— 合入面全在 Mac build / 版本 / 文档层,与本分支的 app 层改动无重叠:

| 文件 | 内容 |
|---|---|
| `packages/branding/scripts/build-deskfox-electron.sh` | arch→产物目录映射修正 + 架构断言(`lipo -archs`) |
| `packages/branding/__tests__/build-electron-arch-outdir.test.ts` | 新增 9 用例守卫该映射 |
| `.husky/pre-push` | 补 branding 单测 backstop(此前发布脚本守卫写了从不跑) |
| `packages/branding/installer-versions.json` | `macos` prod `2026.9.0` → `2026.9.1`(已发版) |
| docs | electron-replatform-macos / macos-install-restart-no-quit / ship 台账 / installer-versions |

### 7.2 修 locale 检测的跨 ICU 版本行为分叉

**症状**:合入后 Mac 端 app 单测比 Win 端在案基线**多红 1 条** ——
`desktop native locale detection > uses Unicode likely subtags for script-sensitive bundles`,
`detectDesktopNativeLocale(["pa-PK"])` 期望 `pa`、实到 `en`。

**根因**(实测,非推断):

| 输入 | 本机(macOS / Bun 1.3.14,新 CLDR) | Win 端(旧 ICU 数据) |
|---|---|---|
| `pa-PK` maximize | `pa-**Aran**-PK` | `pa-**Arab**-PK` |
| 候选 `pa` 的标签 `pa-Arab-PK` maximize | `pa-Arab-PK` | `pa-Arab-PK` |

`detectDesktopNativeLocale` 按 `script` **全等**比对 → 新 ICU 下 `Aran ≠ Arab`,匹配不到候选,静默回落 `en`。
Aran 是 Arab 的 **Nastaliq 书写变体**(UTS #35),不是独立文字系统 —— 全等比对本身是上游的健壮性缺陷,
只是旧 ICU 数据把它盖住了。**这不是本次 merge 引入的回归**,是同一份上游代码在两端 ICU 数据版本下的行为分叉。

**修法**(`packages/app/src/i18n/desktop-native.ts`,FORK-BEGIN/END 一块 + 比对处一行 FORK):
加 `SCRIPT_ALIASES` 归一化(`Aran → Arab`),比对走 `script()` helper。
只拉平 Arab 系变体,`Guru` / `Cyrl` / `Latn` 等真正不同的文字系统不受影响
(测试显式钉住:`pa-Guru-IN` 仍跳过 `pa` 候选)。

**测试**(R5,fix 与测试同 commit):新增 `treats the Aran script variant as Arab across ICU data versions`
—— `pa-Arab-PK` / `pa-Aran-PK` 两种形态都须落 `pa`,并反向钉住 Guru 不被误拉平。改前实测 2 红,改后 9/9 绿。

> ⚠️ 沉淀:**"Win 绿 ≠ Mac 绿"的一类新成因 —— 运行时 ICU/CLDR 数据版本差异**。
> 这类红不会在同一端复现,双端接力时容易被误判成"对方引入的回归"。判读要点:先看文件有没有 FORK marker
> (纯上游文件 + 只在单端红 ⇒ 优先怀疑运行时数据差异),再用 `bun -e` 直接打印 `Intl.Locale(x).maximize()` 取证。

### 7.3 Mac 端完整验收结果

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --filter='!./packages/console/*'` | ✅ **29/29** |
| app `test:unit` | **960 pass / 3 fail** —— 3 条 = 在案 REQ-105 基线红(`server-session.test.ts`),与 Win 端同名同条件;修 locale 前是 960/4 |
| app `test:browser` | ✅ 41/41 |
| branding(main 新带入的 arch 守卫) | ✅ 61/61 |
| media-gen | ✅ 140/140 |
| adapter-feishu-lark | ✅ 792/792 |
| session-ui | ✅ 86/86 |
| 两条 fork 守卫 spec(`PLAYWRIGHT_WORKERS=1`) | ✅ **5/5**(`classic-layout-default` 2 + `v2-fork-customizations` 3) |
| e2e 全量(`PLAYWRIGHT_WORKERS=4`) | ✅ **128/128**,1.8 分钟 |

**e2e 双端对照**:Win 端 126/126 用 3.4 分钟(16 核,需从默认 8 workers 降到 4 才稳);
Mac 端 128/128 用 **1.8 分钟**,同样 4 workers 一次全绿、无 flake 重跑。用例数 126→128 的增量
即 `keep-legacy-layout` 新增的守卫。Playwright 浏览器装在 `PLAYWRIGHT_BROWSERS_PATH=/Volumes/ExtSSD/devcache/ms-playwright`
(遵「软件装 ExtSSD」约束),webServer 由 playwright 自动起 `:4319`,不碰 user 常驻的正式版实例。

### 7.4 Mac 端遗留

- **真机 CDP 验收未在 Mac 端做**:`keep-legacy-layout` 的 8 处 fork 交互 + 经典布局默认,
  Win 端已逐项 CDP 实测通过;Mac 端(尤其托盘 / Dock / 菜单 native 层)按「真桌面 QA ≠ CDP 自测」仍需单独验。
- `bun.lock` 在本机 `bun install` 后会被写入 npmmirror 镜像 URL(3416 行噪音差异),**已还原、未入 commit**;
  双端协作时注意别把它带进去。

#### Mac 端 local 打包的两个环境坑(2026-08-12 实撞,下次直接照做)

Mac wrapper(`.sh`)未集成 local 档,按规范 §5.3 走裸命令时连撞两个,**都不是代码缺口**:

| # | 症状 | 根因 | 解法 |
|---|---|---|---|
| 1 | `prebuild` 报 `No version matching "0.0.0-next-16350" found for @opencode-ai/cli-darwin-arm64 (but package exists)` | sidecar 版本(上游 `scripts/utils.ts` 的 `CLI_VERSION`,来自上游 commit `9e432a6785`)在 **npmmirror 尚未同步**;`npm view` 走官方源查得到、`bun` 走 `bunfig.toml` 镜像查不到 | `BUN_CONFIG_REGISTRY=https://registry.npmjs.org` 跑 build |
| 2 | `electron-builder` 在 `downloaded label=electron progress=100%` 之后挂死,10 分钟后 `⨯ Timeout awaiting 'request' for 600000ms` | 本机 Clash 代理(`HTTP(S)_PROXY` / `ALL_PROXY`)拖死 electron 本体之后的后续请求;electron zip 其实已在 `~/Library/Caches/electron/` | `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u ALL_PROXY -u all_proxy` 后再跑 |

> 坑 2 与 [公证卡 In Progress 摘代理直连] 是**同一个根因家族**:这台机器上凡是长连接 / 大文件的
> 外网请求,套代理都容易永久挂起。Mac 端跑任何 electron-builder / notarytool 类命令,默认先摘代理。

**另记一条判读纪律**:`dist-deskfox/mac-arm64/` 下躺着 8月11 的旧 `DeskFox.app`(以及
`mac/` 和 `mac-arm64-restored/` 两个更旧的残留目录)。验证时**一律用 `find -newermt <本次构建起始时刻>`
卡时间戳**,只认本次产物 —— 这正是 `fix(branding)` 那笔(`758e6e27c6`)记录的「验到上次构建的残留包
却报绿」陷阱,本轮排查中差点复现(先看到 `DeskFox.app` 一度误判为渠道注入失败,查时间戳才发现是残留)。

### 7.5 模块级一致性比对(user 2026-08-12 要求)

> **问题意识**:e2e 全绿 ≠ 功能一致。本 changelog §三 已记过这个教训 ——「e2e 123/123 全绿没抓到,
> 因为用例多来自上游、断言上游语义」。故按 D-4 的三层机器比对思路**以当前 HEAD 重跑一遍**,
> 基准仍取合上游之前的 DeskFox(`e77443750e`)。

#### 第 1 层 — FORK marker 文件级 diff

先排除噪音:`FORK-i18n-backfill`(段4 上游 i18n 全球化时 fork 补的 en 兜底)在 17 种语言文件里
命中上万次,与功能无关。按真 marker 格式(`FORK:` / `FORK-BEGIN:` / `FORK-END`)统计:
基准 **1230 处 / 261 文件** → HEAD **1283 处 / 272 文件**。

其中 **18 个文件丢掉了全部 marker**,逐个判定(11 个是文件被上游删除,7 个是文件仍在但 marker 没了):

| 文件 | 判定 | 依据 |
|---|---|---|
| `desktop/src/main/menu.ts`(基准 8 处) | **非缺口** | 段4 菜单上游化,应用菜单 i18n 由上游 `DESKTOP_NATIVE_*` 方案接管;fork 另起 `native-menu-i18n` 桥补上上游没覆盖的**右键菜单**那半 |
| `app/src/components/windows-app-menu.tsx`(3 处) | **非缺口** | 品牌从 `BRAND = rebrandValue("OpenCode")` 常量改走 i18n key + `rebrandDict` 出口替换,**覆盖面反而更广**(见下方实证) |
| `core/src/v1/session.ts`(1 处) | **非缺口** | 上游拆 schema 包,定制随之迁到 `packages/schema/src/v1/session.ts:246`,marker 与注释都跟着搬了;`core/test/v1-session-legacy-data.test.ts` 老数据测试 2/2 绿 |
| `app/src/components/help-button.tsx`(1 处) | **有意跟随上游** | 原 fork 因上游内容是 Lorem ipsum 占位而隐藏;v1.18.4 上游已填真实内容(Tabs 介绍视频/图文),故撤隐藏 |
| `app/src/context/prompt.tsx`(2 处) | **非缺口** | `commentOrigin: "review"\|"file"\|"quote"` 与 `kind: "chat"\|"file"` 类型定义搬到 `prompt-input*.tsx` / `comment-note.ts` / `dom-provider.ts`,功能完整 |
| `app/src/components/dialog-edit-project.tsx`(2 处) | **非缺口** | 逻辑重构进 model,`iconOverride` 仍在 |
| `app/src/context/file/path.ts`(1 处) | **非缺口(且 Win 专属)** | 上游自己做了 backslash 归一;该定制原本只解 Windows 路径问题,对 Mac 无影响 |
| 其余 11 个(`ui/src/components/markdown*` / `message-part*` / `file-media.tsx` / `tabs-dedup.ts` / `message-timeline.tsx` / `dialog-select-provider.tsx` 等) | **文件被上游删除** | 段2 markdown→session-ui 搬家、段3 组件重构;D-5 已逐条核实为有意撤销/重构合并 |

**品牌链路实证**(没有只读代码下结论,直接跑 `rebrandDict` 打印实际输出):
`DESKTOP_NATIVE_ENGLISH` 里 9 条带 "OpenCode" 的值,经 rebrand 后 —— 6 条正确变成 DeskFox
(`desktop.menu.app` = "DeskFox"、`desktop.menu.ariaLabel` = "DeskFox menu"、
`desktop.recovery.loadFailed` = "DeskFox failed to load" 等),3 条 `desktop.wsl.*` 保留 "OpenCode",
符合 `rebrand.ts` 的明确豁免(WSL 场景里 OpenCode 指真实 `opencode` CLI 二进制名)。
接线确认在 `language.tsx:49/55` 的 dict flatten 出口,`en.ts` 通过 `...DESKTOP_NATIVE_ENGLISH`
spread 覆盖全部 90 个 native key,故原生菜单 bundle 的 `?? DESKTOP_NATIVE_ENGLISH[key]` 兜底分支
不会被触发、不存在未替换品牌串外泄路径。

> ⚠️ 排查中的一次**自查纠错**:初版脚本按字面 key 统计,报 `en.ts` 覆盖 0/90、疑似品牌大面积泄漏。
> 复核发现 `en.ts` 是 spread 引入而非字面 key,是脚本误报。**结论改为无泄漏,并改用实跑取证代替静态读码。**

#### 第 2 层 — 用户可触达入口 diff(零丢失)

| 维度 | 基准 | HEAD | 丢失 | 说明 |
|---|---|---|---|---|
| 快捷键绑定 | 34 | 37 | **0** | `mod+t` → `mod+t,mod+n`(加别名非丢失);新增 3 个为上游新功能 |
| 命令面板条目(`command.*` i18n key) | 82 | 86 | **0** | 新增 4 个:导出日志 / 导出会话 / 重开已关闭 tab |
| 菜单与右键菜单文案 key | 30 | 31 | **0** | 新增 1 个:`context.export.session` |
| tab 右键菜单动作 handler | 3 | 3 | **0** | D-4 修复后保持 |

#### 第 3 层 — macOS 专属定制清单(静态全在)

Mac 平台层是 Win 端**验不了**的部分,逐条确认 FORK marker 仍在:

| # | 定制 | 落点 |
|---|---|---|
| 1 | HTML 预览右键加聊天(contextmenu 桥接注入) | `main/deskfox/local-asset.ts:141` |
| 2 | 托盘 template image(随系统菜单栏明暗反色) | `main/deskfox/tray.ts:87` |
| 3 | 外置/网络盘挂载根探测(REQ-070) | `main/fs-probe.ts:59` + 测试 |
| 4 | Dock 图标点击重现主窗口 | `main/index.ts:262` |
| 5 | 关闭到托盘 backstop | `main/index.ts:284` |
| 6 | 防休眠开关持久化 + 启动恢复 | `main/index.ts:359` + `store-keys.ts:7` |
| 7 | 「安装并重启」绕开托盘拦截 | `main/updater.ts:5/46` |

丢失的 `desktop-menu-i18n.ts` 及其测试 = `menu.ts` 那套 fork 菜单 i18n 的实现本体。
静态判定为「被上游方案取代」—— **但真机 A/B 推翻了这个判定的一半,见 §7.6**。

#### 结论(代码层)

三层机器比对未发现任何"定制被上游 merge 静默冲掉"的情况;所有 marker 消失点都能归到
「随上游重构迁移」「有意撤销跟随上游」「Win 专属不影响 Mac」三类之一,逐条有实证或在案决策(D-5)支撑。

> ⚠️ **但代码层零缺口 ≠ 用户体验零变化。** 静态比对能证明「代码还在」,证明不了「行为一样」——
> `menu.ts` 就是活例:静态看是"上游方案接管、非缺口",真机一读菜单栏才发现上游方案**只翻译带
> `labelKey` 的项**,纯系统 role 项(About/Hide/Quit…)静默退回英文。详见 §7.6。

### 7.6 真机验收(Mac,local 档 2026.9.1 arm64)

产物 `dist-deskfox/mac-arm64/DeskFox 本地版.app`,启动前先过身份闸(`CFBundleIdentifier`
必须是 `ai.deskfox.app.local`,否则拒绝启动 —— 防抢正式版 DB / 单例锁)。
**全程 user 的正式版进程未受影响。**

#### CDP 只读断言(对齐 Win 端 keep-legacy-layout §四 那张表)

| 项 | Win 端结果 | Mac 端本次 | |
|---|---|---|---|
| 经典布局默认 | 无 `data-new-layout` | `body`/`html` 均 null | ✅ |
| 渠道徽标 | 1 个 LOCAL | 1 个 LOCAL | ✅ |
| 标题栏工具组锚左 | 左 portal x=40 / 3 按钮,右 0 | 左 x=84 / 3 按钮(状态·切换文件树·切换审查),右 0 | ✅ |
| 文件树开关 | x=92 居三图标之中 | 「切换文件树」x=136 | ✅ |
| 文件树 tab 顺序 | 「所有文件」在左 /「N 更改」在右 | 所有文件 x=37 / 0 更改 x=149 | ✅ |
| 镜像布局 | 树在左、聊天在右 | 树 x=0 / composer x=277 | ✅ |
| 伪 tab 残留 | 0 | false | ✅ |
| 界面语言 | — | `html[lang=zh-Hans]` | ✅ |
| 渲染崩溃 | 无 | 无 | ✅ |

#### macOS 原生菜单(Win 端**无法验**的部分)

用 AppleScript 直接读系统菜单栏,并与 user 正在运行的**正式版做 A/B 对照**:

```
本分支 local 包  TOP: Apple | DeskFox 本地版 | 文件 编辑 视图 转到 窗口 帮助
正式版(对照)     TOP: Apple | DeskFox        | 文件 编辑 视图 前往 窗口 帮助
```

顶层菜单中文渲染正常 ⇒ **IPC 把 bundle 送达主进程这条链路是通的**(离线只能证明 bundle 内容对,
送达与否只有真机能证)。但应用菜单内部出现分叉:

| 菜单项 | 正式版 | 本分支(修复前) | 性质 |
|---|---|---|---|
| 关于 | 关于 DeskFox | `About DeskFox 本地版` | **回归** |
| 隐藏 | 隐藏 DeskFox | `Hide DeskFox 本地版` | **回归** |
| 隐藏其他 | 隐藏其他 | `Hide Others` | **回归** |
| 全部显示 | 全部显示 | `Show All` | **回归** |
| 退出 | 退出 DeskFox | `Quit DeskFox 本地版` | **回归** |
| 顶层「前往」 | 前往 | 转到 | 上游译法差异(不改) |
| 重新加载 | 重新加载页面 | 重新加载 Webview | 上游译法差异(不改) |

**根因**:About / Hide / Hide Others / Show All / Quit 在 `DESKTOP_MENU` 里**没有 `labelKey`**
(靠 Electron 的 role 自带标签),走不到上游的 `nativeT`;而 Electron 的 role 默认标签跟随
**app bundle 本地化**而非系统语言 —— 实测这台机器系统菜单(Apple 菜单「关于本机 / 系统设置…」)
是中文,DeskFox 的 role 项却是英文,于是「应用菜单一半中文一半英文」。

fork 原本有 `roleLabel()` 专治这个(基准 `menu.ts` 的 FORK 块,注释原文:「纯系统 role 在
DESKTOP_MENU 里无英文 label,无法走 translateMenuLabel — 这里按 role 直接给带应用名译名」),
段4「菜单上游化」时随 `desktop-menu-i18n.ts` 一并撤除,**撤过头了**。

**修复**(本轮):
- 新增 `packages/desktop/src/main/menu-role-label.ts`(fork-only)—— 按原语义回植 zh / zht 两档;
  未覆盖语言返回 `undefined` → 保持纯 role、退回系统默认(不回归)。
- `native-translations.ts` 加 `nativeLocale()` getter(1 处 FORK);`menu.ts` 在 `labelKey` 缺省时
  用 `roleLabel(role, nativeLocale(), app.getName())` 兜底(1 处 FORK)。
- **独立成文件而非留在 `menu.ts`**:后者顶层 `import electron`,bun 单测环境加载即报
  `Export named 'nativeTheme' not found`;抽出纯函数才进得了 Logic 清单。
- 测试 `menu-role-label.test.ts` 5 条(zh / zht / 带渠道后缀的应用名 / 未覆盖语言回落 / 未覆盖 role 回落)。

#### 真机暴露的第二个问题 — 存量 DB 迁移失败(**高危,见 §7.7**)

### 7.7 界面层全面测试(user 2026-08-12 要求,local 档 arm64)

工具:仓内 `packages/branding/smoke/smoke.py` 全量冒烟引擎 + CDP `Page.captureScreenshot` 截图
+ AppleScript 读原生层。**截图用 CDP 而非 `screencapture`** —— 本机是多屏,窗口 logical x 为
**负值(-1475,在副屏)**,`screencapture` 只截主屏会得到全白图;CDP 直接从渲染器取,不受屏幕坐标影响。

#### 冒烟引擎:22 项通过 / 0 警告 / 0 崩溃

| 组 | 覆盖 |
|---|---|
| boot | reload + 启动期健康(无 error toast / JS 异常) |
| providers ×10 | 逐个点开连接弹窗:**GetBot(排首位 + 推荐标,fork 定制)** / OpenCode Zen / OpenCode Go / Anthropic / GitHub Copilot / OpenAI / Google / OpenRouter / Vercel AI Gateway / 自定义提供商 |
| panels ×5 | 切换侧边栏 / 切换文件树 / 切换审查 / 状态 / 新建会话 |
| settings ×6 | 通用 / 快捷键 / 服务器 / 提供商 / 模型 / **飞书桥接(fork 自有页)** |

#### 逐项界面验证(截图 + 实测值)

| 项 | 结果 |
|---|---|
| 命令面板 ⌘K | ✅ 打开,全中文,快捷键按 macOS 符号渲染(⇧⌘S / ⌥↑ / ⌃\` / ⇧⌘R) |
| Markdown 预览 | ✅ 标题层级 / 引用块 / 有序列表 / 粗体 / 中文排版全部正确 |
| 终端 | ✅ ghostty canvas 渲染,shell prompt 正常出(`openclaw@… my-life %`) |
| Fox Blue 主题 | ✅ 实测 token:`--surface-base-active` 由 OC-2 的 `#e2e2e2` → `#7295c452`(logo 蓝 rgb(114,149,196) α=0.32),与 `theme.css` 定义一致。注:需 `data-theme` + `data-color-scheme` **两个属性**同时命中才生效 |
| 左下角品牌 | ✅ 「DeskFox for macOS v2026.9.1」 |
| 内置 LibreOffice | ✅ 用**包内那份** soffice 成功转出 docx / pdf / xlsx —— 剥皮后的 bundle 是健康的 |

#### 本轮界面测试抓到的第 3 个 bug(已修,见下)

user 看截图直接指出:「所有文件」一栏把标题前面挡住了,宽度不够应该省略右侧而不是切左边。
实测确认并修复,详见 `fix(layout)` 一笔与下方 §7.8。

#### 未能覆盖的部分(如实记录)

- **Office / PDF 文档预览端到端 UI 未验**:DeskFox 的文件预览是**项目内文件树驱动**的,
  `open -a <目录>` 与 `open -a <文件>` 都不会把外部路径变成预览 tab。改走原生菜单
  「文件 → 打开项目…」时 NSOpenPanel 确实弹出,但 `Cmd+Shift+G` 路径跳转的键盘注入未生效
  (原生对话框焦点/时序,与 memory 既有记录一致),已 Esc 关闭。
  **已验证的是**:内置 LO 本体可用(成功转换三种格式)、Win 端验证过预览代码链路
  (`session.tsx → SessionSidePanel → FileTabContent → document-viewer`);
  缺的是 Mac 端把这条链路真点一遍。**建议由 user 手工点一次 .docx / .pdf 收口。**
- 右键菜单未逐项点验(smoke 引擎不覆盖)。

#### 测试期间对 user 环境的影响与恢复

local 档启动时 `plugin-install.ts` 会做 **exclusive takeover**,把共享
`~/.config/opencode/opencode.jsonc` 的 plugin 路径从 `ai.deskfox.app` 改成 `ai.deskfox.app.local`。
本轮多次启停,每次均已改回;收尾时 `diff` 校验与测试前备份**完全一致**。
备份留在 `~/.config/opencode/opencode.jsonc.bak-before-local-fix-*`。
**这说明 local 档的「数据隔离」不覆盖共享 config** —— 与「local 与正式版共存互不打扰」的设计目标
有出入,是一个**独立待办**(本轮未处理)。

### 7.8 经典布局镜像溢出方向缺陷(user 真机指出,已修)

**现象**:1280 宽窗口下,文件树面板左缘跑到 x=24、压在 activity rail(右缘 48)底下,
「所有文件」tab 与 `.deskfox` 开头的字符被盖掉。

**取证**(CDP 命中测试,不靠肉眼):在该 tab 自己的矩形内 `elementFromPoint(x, y)` 命中的是
**rail 的项目图标**而非 tab —— 铁证。

**根因**:REQ-041 五栏镜像用 `md:flex-row-reverse`(`session.tsx`)。该容器两个子项
(聊天区 / 侧面板)都是 style 固定宽度,总宽超出可用宽度时必然溢出;而 `row-reverse` 会把
**溢出方向从「右」翻成「左」**,左边正是 rail 的地盘。实测:可用 770,聊天区 570 + 侧面板 240 = 810,
超 40px,面板 x 由应有的 64 变成 24。

> **该缺陷不是本次上游同步引入的** —— `md:flex-row-reverse` 在基准 `e77443750e`(2026-06-12 REQ-041)
> 即存在;`--main-right`(右侧项目面板)基准也已有。属 fork 长期布局缺陷,只在窗口宽度不足时暴露,
> user 平时窗口开得大所以一直没撞上。

**修法**:改用 `order` 实现镜像 —— 视觉顺序与 DOM 顺序都不变(上游增删子项仍可正常 merge),
溢出方向恢复向右,即 user 要求的「宽度不够该省略右侧」。
容器 `md:flex-row-reverse` → `md:flex-row`;侧面板加 `md:order-first`;`mobileTabs` 加 `md:order-last`。

**真机复验**:面板 x **24 → 64**(rail 右缘 48,不再重叠),tab x 37 → 77,
命中测试由 rail 图标变为 tab 自身,截图确认 `.deskfox` 开头的点已回来。

**遗留(未在本笔处理)**:总宽 810 > 可用 770 这个**根问题仍在**,现表现为聊天区右缘 875 超出
容器 835、被右侧面板遮 40px(方向已符合要求)。窄窗口下还有一个更明显的后果:
**打开文件预览后预览区被压到 ~80px 宽,文字竖排成一列不可读**;窗口拉到 1475 宽即完全正常
(侧面板 515 = 文件树 240 + 预览 275,聊天区自适应 450,`scrollWidth == clientWidth` 无溢出)。
彻底消除需让聊天区宽度自适应(现为 `md:flex-none` + style 固定宽,且该宽度用户可拖拽),
或给预览区设 min-width —— 属产品设计决策,**留待 user 拍板**。
