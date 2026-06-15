feat-id: fox-blue-theme
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md

# Fox Blue 主题 — 实施计划 + 决策轨迹

## 调研结论(动工前)

- **主题发现机制**:桌面端 `packages/ui/src/theme/context.tsx` 用 `import.meta.glob("./themes/*.json")` 自动扫目录;`ids()`/`knownThemes()` 都基于此;`name(id)=store.themes[id]?.name ?? names[id] ?? id`。→ 加 json 即入选择器,名取 json `name`。
- **主题 CSS 注入**:`applyThemeCss()` 把 token 输出到 `:root`,并在 `<html>` 设 `data-theme=<id>` + `data-color-scheme=<light|dark>` 两属性 → **天然 scope 钩子**。
- **品牌蓝**:`packages/branding/src/theme.css` 定义 Cool Blue `#7295c4`(logo「Fo」/嘴/链接)= 选定的「logo 蓝」。
- **四处选中态 token 溯源**:
  - 文件树选中(`file-tree.tsx:332` `.bg-surface-base-active`)/ 会话列表选中(`sidebar-items.tsx:220` `has-[.active]:bg-surface-base-active`)/ 设置导航选中(`tabs.css:579` `[data-variant=settings]:has([data-selected])`)→ **三处共用 `--surface-base-active`**。
  - 开关 ON(`switch.css:97` `[data-checked] [data-slot=switch-control]`)→ `--icon-strong-base`(近黑,且共享给图标/正文)。
- **稳定选择器锚点**:文件树行 `[data-tree-path]`(FORK 属性)/ 会话列表行 `[data-session-id]` / 设置导航 `[data-component="tabs"][data-variant="settings"] [data-slot="tabs-trigger-wrapper"]` / 开关 `[data-component="switch"][data-checked]`。

## 决策轨迹

- **D1**:蓝色差异放 json 还是 CSS?→ **CSS**。json 留 OC-2 纯克隆,merge 友好 + clone 测试可守;CSS 集中所有蓝逻辑一处。
- **D2**:选中底色用 token 还是选择器?→ 三处共用 `--surface-base-active` 且语义正好是「激活态底色」→ **改 token**(一处覆盖三处,hover 走 `--surface-base-hover` 不受影响);开关/hover 共享 token 会污染 → **选择器精确覆盖**。
- **D3**:Explore 子代理两次定位偏差(把设置导航指到 `tabs-v2.css`、开关指到 `switch-v2.css`)→ 实测纠正:V1 设置弹窗用 `data-component="tabs"`(非 v2)、设置页开关用 v1 `switch.css`(非 v2)。**教训:组件多版本并存时,以运行时实际渲染的 data-component 为准,不轻信静态搜索首个命中。**
- **D4**(追加需求 7):文件树文字偏浅(`.text-text-weak` #8F8F8F)vs 会话列表(`.text-text-strong` #171717)→ scope `[data-tree-path] .text-text-weak { color: var(--text-strong) }`;只改色不动字号字重;诊断色(inline)/ignored(`.text-text-weaker`)保留。
- **D5**(追加需求 8/9):hover 三档反馈。hover 蓝**精确 scope 到三个列表项**(不redefine 全局 hover token,避免普通按钮全变蓝)。规则与上游各自 `hover:bg-*` 命中同一元素同一时机 → 不引入新 hover 行为,仅换色。三档:浅 0.12 / 选中 0.32(token)/ 选中+hover 0.44,靠选择器特异度(`html[2 attr]` 前缀)稳压上游。

## 实施步骤

1. `cp oc-2.json fox-blue.json` + 改 name/id;统一 CRLF;clone diff 仅 2 行。
2. `branding/src/theme.css` 加 fox-blue scoped 块:① surface-base-active 蓝 ② 开关 ON 实心蓝 ③ 文件树文字 strong ④ hover 三档。
3. 加 `fox-blue.test.ts` clone 完整性测试。
4. 构建 dev renderer + CDP 实算验证 10 条验收点。

## 验证记录

- clone 测试 3 pass / 7 expect ✓
- CDP(electron 直跑 out/,真实 14 文件树行 + 40 会话行):
  - `--surface-base-active = #7295c452`(=rgba(114,149,196,0.32))✓
  - 开关 ON `rgb(114,149,196)` ✓
  - 文件树文字 `rgb(23,23,23)` = `#171717` ✓
  - hover 未选中 `rgba(114,149,196,0.12)` ✓ / 选中+hover `rgba(114,149,196,0.44)` ✓
  - `data-theme=fox-blue` / `data-color-scheme=light` ✓
- 真桌面 QA(视觉对齐 / 真实 hover 手感)待 user。

## 已知遗留 / 待 user 拍板

- 列表选中蓝用的是 **alpha 浅调**(便于文字可读);若 user 想要更实/更深的纯 logo 蓝,调 `theme.css` 内 alpha 值即可(单点)。
- 深色定制:目前 = OC-2;待 user 决定是否也要深色版蓝(scope 加 `[data-color-scheme="dark"]` 即可)。
- dev/prod **打包**目前卡在一个与本主题无关的 **icon 256x256 校验**报错(channel 图标产出 128px)→ 另记,不属本 feat。本次验证走 electron 直跑 `out/` 绕过打包。
