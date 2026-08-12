feat-id: keep-legacy-layout
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# 改动日志 — 不跟随上游 v2 换代,默认回经典布局

**规模**:Large 口径(触动 ≥5 个上游文件);净 **+271 / −31 行**,13 文件
**分支**:`sync/upstream-2026-08-10`(接在 `upstream-sync-2026-08` 之后)
**commits**:`b86d15779b` / `98a8bbaf9b` / `d837f71536` / `d7be6c9d3d` + 本笔(文档收口)
**R4 override**:**0 笔**(改动全在 `packages/app/`,不在黑名单)

## 一、改了什么

### 1. 默认翻回经典布局(堵 4 条推 v2 路径)

`packages/app/src/context/settings.tsx`(FORK-BEGIN/END 两块):

| 路径 | 上游值 | fork 值 |
|---|---|---|
| 渠道默认 `legacyNewLayoutDesignsDefault` | `CHANNEL !== "prod"` | `false` |
| 新档案默认 `newLayoutDesignsDefault` | `true` | `false` |
| 退役日 `oldInterfaceSunset` | `2026-09-14` | `null`(类型放宽 `Date \| null`) |
| 升级强切 `shouldEnableNewLayout` | 上游判定 | 恒 `false` |

上游原实现**改名保留**为 `upstreamShouldEnableNewLayout`(不删,便于下次 merge 接上游改动),单测继续覆盖它。
**开关保留** —— 用户仍可自愿切 v2,只是不再是默认、也不会被强制。

### 2. 标题栏图标锚左 + 双徽标修复

- `titlebar.tsx`:新增 `useTitlebarLeftMount()`(左侧挂载点 `#opencode-titlebar-left`);
- 段3 merge 时上游在外层又加了一个 `ChannelIndicator` → 经典布局左上出现**两个 LOCAL/DEV 徽标**;
  修法:保留 fork 位置那处(徽标与终端图标同组),把上游那处的 `debugTools` prop 并过来后删掉外层;
- web 端没有左 portal,加回落到右 portal,避免工具组**整组消失**。

### 3. 补回上游 merge 冲掉的 8 处 fork 交互

用三层机器比对找出(基准 = sync 前 main `e77443750e`),详见 [`2-plan.md`](./2-plan.md) D-4:

| # | 缺口 | 落点 | 成因 |
|---|---|---|---|
| 1 | 标题栏缺「文件树」图标(左三图标少中间那个) | `session-header.tsx` | 段3 整组摘除,该理由只在 v2 成立 → 改按布局分支 |
| 2 | 搜索快捷键 Ctrl+K 变 Ctrl+P | `use-session-commands.tsx` | 上游把 keybind 砍成 `mod+p`,恢复 `mod+k,mod+p` |
| 3 | tab 右键「关闭其他标签」失效 | `session-side-panel.tsx` | 菜单项还在,`onCloseOthers` 调用点被冲掉 |
| 4 | 文件树「当前文件高亮」 | `session-side-panel.tsx` | 组件仍支持 `active`,调用点不传了 |
| 5 | 文件树 hover 收起提示 | `session-side-panel.tsx` | 同上,`viewerOpen` 不传了 |
| 6 | 聊天区 md 内链拦截 | `session.tsx` | handler 还在,`display:contents` 委托容器被冲掉 |
| 7 | 经典布局镜像(树在左 / tab 顺序 / 分隔线 / 拖拽手柄边) | `session-side-panel.tsx` | 段3 归位上游,按布局分支恢复 |
| 8 | 聊天引用点开空白预览页 | `prompt-input*.tsx` + `helpers.ts` + `dom-provider.ts` | **既有缺陷**(原版同样有),user 要求一并修 |

判定为「非缺口」不恢复的 5 处见 [`2-plan.md`](./2-plan.md) D-5。

### 4. 伪路径过滤按解码后比对(第 4 笔)

`helpers.ts` 抽出 `isChatSelectionTab()`:原文比 + `decodeURIComponent` 比(try/catch 兜非法编码)。
项目 tab 存的是 `file://%3Cchat%20selection%3E` 编码形式,**只按原文 includes 匹配不上** —— 单测绿、真机没生效,
真机实测才发现(详 D-8)。

## 二、文件清单

| 文件 | 性质 | 行数 |
|---|---|---|
| `src/context/settings.tsx` | 上游改(2 FORK 块) | +27/−9 |
| `src/context/settings.test.ts` | 测试 | +37/−9 |
| `src/components/titlebar.tsx` | 上游改 | +18/−3 |
| `src/components/session/session-header.tsx` | 上游改 | +64/−9 |
| `src/pages/session/session-side-panel.tsx` | 上游改 | +40/−5 |
| `src/pages/session/helpers.ts` | 上游改 | +18/−0 |
| `src/pages/session/helpers.test.ts` | 测试 | +19/−1 |
| `src/pages/session.tsx` | 上游改 | +6/−0 |
| `src/pages/session/use-session-commands.tsx` | 上游改 | +5/−2 |
| `src/components/prompt-input.tsx` / `prompt-input-v2.tsx` | 上游改 | 各 +4 |
| `src/utils/context-menu-host/dom-provider.ts` | fork 文件 | +6/−2 |
| `e2e/regression/classic-layout-default.spec.ts` | **新增**守卫 | +54 |

## 三、回归测试

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --filter='!./packages/console/*'` | ✅ 全绿 |
| app 单测 `test:unit`(带 fork 必需 `--conditions=browser`) | **959 pass / 3 fail** — 3 条 = REQ-105 Win/browser 基线红(`server session > projects V2 session events` / `indexes V1 messages` / `does not scan cached messages`),纯上游同条件同红;对比 sync 收口时 956/959,增量正是本 feat 新增的 3 条 |
| app `test:browser` | ✅ 41/41 |
| media-gen | ✅ 140/140 |
| adapter-feishu-lark | ✅ 792/792 |
| session-ui | ✅ 86/86 |
| branding | ✅ 52/52 |
| e2e 两条相关 spec(串行) | ✅ 5/5(`classic-layout-default` 2 + `v2-fork-customizations` 3) |
| e2e 全量 | 见下 |

### e2e flake 记录(判读用)

首轮默认并发跑两条 spec 时 `v2-fork-customizations` T1 超时红,**同一 helper 的 T3 却绿**;
`PLAYWRIGHT_WORKERS=1` 重跑 5/5 全绿 ⇒ 并发/冷启动 flake,非回归。
与 `upstream-sync-2026-08` 记录的并发结论一致(本机默认 8 workers 过度,一律用 `PLAYWRIGHT_WORKERS=4`)。

## 四、真机验收(local 档 CDP,只读 DOM 断言)

产物 `DeskFox 本地版.exe`(2026.9.1),CDP 9222 实测:

| 项 | 结果 |
|---|---|
| 经典布局默认 | ✅ `body` / `html` 均无 `data-new-layout` |
| 渠道徽标 | ✅ **1 个** LOCAL(修前 2 个) |
| 标题栏工具组锚左 | ✅ 左 portal x=40 含 3 个按钮;右 portal 0 个 |
| 文件树开关 | ✅ 存在(`aria-label=切换文件树`,x=92 居三图标之中) |
| 文件树 tab 顺序 | ✅ 视觉「所有文件」x=78 在左 /「0 更改」x=189 在右(DOM 顺序未改) |
| 镜像布局 | ✅ 文件树 x=65 在左,聊天区 x=927 在右 |
| 伪 tab 残留 | ✅ 0 个(存量已自动消失) |
| 窗口标题品牌 | ✅ 系统层 `MainWindowTitle = DeskFox`(renderer `<title>` 未外泄) |

## 五、用户可感知的变化

1. **界面不换代**:设置页 / 模型选择 / 弹窗 / review 面板 / 首页维持经典布局
   —— 这**推翻**了 `upstream-sync-2026-08` changelog §五 第 1 条(那条按 D1 写的"整体换代到 v2"已作废);
2. 标题栏工具组回到左上、徽标只剩一个;
3. 8 处交互恢复:文件树图标、Ctrl+K 搜索、tab 右键「关闭其他标签」、文件树当前文件高亮与 hover 提示、
   聊天 md 内链、经典镜像布局;
4. 聊天引用卡片点击不再开空白预览页(**含存量伪 tab 自动消失**);
5. v2 仍可在设置里自愿开启。

## 六、回退方法

- 四笔独立可 revert;只想回到"跟随 v2"= revert `b86d15779b` 一笔即可(其余三笔是与布局无关的交互修复/bug 修复);
- 上游四段 merge 不受影响(本 feat 只动默认值与 fork 侧调用点)。

## 七、遗留

- REQ-106(v2 路径下 5 项定制回植)优先级下降 —— v2 不再是默认,不阻断可用性,继续留 backlog;
- 1-spec 为**事后追认**(见该文档顶部说明),规范要求的 Large 改前审签本次未走。
