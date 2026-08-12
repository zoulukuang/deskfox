feat-id: upstream-sync-2026-08
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md

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
